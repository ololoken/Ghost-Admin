import AuthConfiguration from 'ember-simple-auth/configuration';
import RSVP from 'rsvp';
import Route from '@ember/routing/route';
import ShortcutsRoute from 'ghost-admin/mixins/shortcuts-route';
import ctrlOrCmd from 'ghost-admin/utils/ctrl-or-cmd';
import moment from 'moment';
import windowProxy from 'ghost-admin/utils/window-proxy';
import {InitSentryForEmber} from '@sentry/ember';
import {configureScope} from '@sentry/browser';
import {
    isAjaxError,
    isNotFoundError,
    isUnauthorizedError
} from 'ember-ajax/errors';
import {isArray as isEmberArray} from '@ember/array';
import {
    isMaintenanceError,
    isVersionMismatchError
} from 'ghost-admin/services/ajax';
import {inject as service} from '@ember/service';

function K() {
    return this;
}

let shortcuts = {};

shortcuts.esc = {action: 'closeMenus', scope: 'default'};
shortcuts[`${ctrlOrCmd}+s`] = {action: 'save', scope: 'all'};

export default Route.extend(ShortcutsRoute, {
    ajax: service(),
    config: service(),
    feature: service(),
    ghostPaths: service(),
    notifications: service(),
    router: service(),
    session: service(),
    settings: service(),
    ui: service(),
    intl: service(),
    lazyLoader: service(),
    whatsNew: service(),

    shortcuts,

    routeAfterAuthentication: 'home',

    init() {
        this._super(...arguments);
        this.router.on('routeDidChange', () => {
            this.notifications.displayDelayed();
        });
    },

    beforeModel() {
        return this.config.fetchUnauthenticated()
            .then(() => this.ajax.request(`${this.ghostPaths.adminRoot}assets/locales/en.json`)
                .then(translations => this.intl.addTranslations('en', translations))
                .then(() => this.intl.setLocale(['en']))
                .then(() => {
                    if (this.config.get('default_locale')) {
                        return RSVP.all([
                            this.lazyLoader
                                .loadScript('moment-locale', `assets/moment/locale/${this.config.get('default_locale')}.js`)
                                .then(() => moment.locale(this.config.get('default_locale')))
                                .catch(() => (`Looks like momentjs doesn't support your "${this.config.get('default_locale')}" locale`)),
                            this.ajax.request(`${this.ghostPaths.adminRoot}assets/locales/${this.config.get('default_locale')}.json`)
                                .then(translations => this.intl.addTranslations(this.config.get('default_locale'), translations))
                                .then(() => this.intl.setLocale([this.config.get('default_locale')].concat(this.intl.locales)))
                                .catch(e => (`Failed to init translations for "${this.config.get('default_locale')}" locale: ${e.message}`))
                        ]);
                    }
                })
            )
            .then(() => {
                // init Sentry here rather than app.js so that we can use API-supplied
                // sentry_dsn and sentry_env rather than building it into release assets
                if (this.config.get('sentry_dsn')) {
                    InitSentryForEmber({
                        dsn: this.config.get('sentry_dsn'),
                        environment: this.config.get('sentry_env'),
                        release: `ghost@${this.config.get('version')}`
                    });
                }
            });
    },

    afterModel(model, transition) {
        this._super(...arguments);

        if (this.get('session.isAuthenticated')) {
            this.session.appLoadTransition = transition;
            this.session.loadServerNotifications();

            // return the feature/settings load promises so that we block until
            // they are loaded to enable synchronous access everywhere
            return RSVP.all([
                this.config.fetchAuthenticated(),
                this.feature.fetch(),
                this.settings.fetch()
            ]).then((results) => {
                this._appLoaded = true;

                // update Sentry with the full Ghost version which we only get after authentication
                if (this.config.get('sentry_dsn')) {
                    configureScope((scope) => {
                        scope.addEventProcessor((event) => {
                            return new Promise((resolve) => {
                                resolve({
                                    ...event,
                                    release: `ghost@${this.config.get('version')}`
                                });
                            });
                        });
                    });
                }

                // kick off background update of "whats new"
                // - we don't want to block the router for this
                // - we need the user details to know what the user has seen
                this.whatsNew.fetchLatest.perform();

                return results;
            });
        }

        this._appLoaded = true;
    },

    actions: {
        closeMenus() {
            this.ui.closeMenus();
        },

        didTransition() {
            this.session.appLoadTransition = null;
            this.send('closeMenus');
        },

        authorizationFailed() {
            windowProxy.replaceLocation(AuthConfiguration.rootURL);
        },

        // noop default for unhandled save (used from shortcuts)
        save: K,

        error(error, transition) {
            // unauthoirized errors are already handled in the ajax service
            if (isUnauthorizedError(error)) {
                return false;
            }

            if (isNotFoundError(error)) {
                if (transition) {
                    transition.abort();
                }

                let routeInfo = transition.to;
                let router = this.router;
                let params = [];

                for (let key of Object.keys(routeInfo.params)) {
                    params.push(routeInfo.params[key]);
                }

                let url = router.urlFor(routeInfo.name, ...params)
                    .replace(/^#\//, '')
                    .replace(/^\//, '')
                    .replace(/^ghost\//, '');

                return this.replaceWith('error404', url);
            }

            if (isVersionMismatchError(error)) {
                if (transition) {
                    transition.abort();
                }

                this.upgradeStatus.requireUpgrade();

                if (this._appLoaded) {
                    return false;
                }
            }

            if (isMaintenanceError(error)) {
                if (transition) {
                    transition.abort();
                }

                this.upgradeStatus.maintenanceAlert();

                if (this._appLoaded) {
                    return false;
                }
            }

            if (isAjaxError(error) || error && error.payload && isEmberArray(error.payload.errors)) {
                this.notifications.showAPIError(error);
                // don't show the 500 page if we weren't navigating
                if (!transition) {
                    return false;
                }
            }

            // fallback to 500 error page
            return true;
        }
    }
});
