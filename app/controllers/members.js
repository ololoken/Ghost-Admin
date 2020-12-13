import Controller from '@ember/controller';
import ghostPaths from 'ghost-admin/utils/ghost-paths';
import moment from 'moment';
import {A} from '@ember/array';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency-decorators';
import {timeout} from 'ember-concurrency';
import {tracked} from '@glimmer/tracking';

const PAID_PARAMS = [{
    name: 'members.All members',
    value: null
}, {
    name: 'members.Free members',
    value: 'false'
}, {
    name: 'members.Paid members',
    value: 'true'
}];

export default class MembersController extends Controller {
    @service intl;
    @service ajax;
    @service config;
    @service ellaSparse;
    @service feature;
    @service ghostPaths;
    @service membersStats;
    @service store;

    queryParams = [
        'label',
        {paidParam: 'paid'},
        {searchParam: 'search'},
        {orderParam: 'order'}
    ];

    @tracked members = A([]);
    @tracked searchText = '';
    @tracked searchParam = '';
    @tracked paidParam = null;
    @tracked label = null;
    @tracked orderParam = null;
    @tracked modalLabel = null;
    @tracked showLabelModal = false;
    @tracked showDeleteMembersModal = false;

    @tracked _availableLabels = A([]);

    get paidParams() {
        return PAID_PARAMS.map(({name, value}) => Object({name: this.intl.t(name).toString(), value}));
    }

    constructor() {
        super(...arguments);
        this._availableLabels = this.store.peekAll('label');
    }

    // Computed properties -----------------------------------------------------

    get listHeader() {
        let {searchText, selectedLabel, members} = this;

        if (members.loading) {
            return this.intl.t('members.Loading...');
        }

        if (searchText) {
            return this.intl.t('members.Search result');
        }

        if (selectedLabel && selectedLabel.slug) {
            return this.intl.t('members.{matches, plural} current filter', {matches: members.length});
        }
        return this.intl.t('members.{members, plural}', {members: members.length});
    }

    get showingAll() {
        return !this.searchParam && !this.paidParam && !this.label;
    }

    get availableOrders() {
        // don't return anything if email analytics is disabled because
        // we don't want to show an order dropdown with only a single option

        if (this.feature.get('emailAnalytics')) {
            return [{
                name: this.intl.t('members.Newest'),
                value: null
            }, {
                name: this.intl.t('members.Open rate'),
                value: 'email_open_rate'
            }];
        }

        return [];
    }

    get selectedOrder() {
        return this.availableOrders.find(order => order.value === this.orderParam);
    }

    get availableLabels() {
        let labels = this._availableLabels
            .filter(label => !label.isNew)
            .filter(label => label.id !== null)
            .sort((labelA, labelB) => labelA.name.localeCompare(labelB.name, undefined, {ignorePunctuation: true}));
        let options = labels.toArray();

        options.unshiftObject({name: this.intl.t('members.All labels'), slug: null});

        return options;
    }

    get selectedLabel() {
        let {label, availableLabels} = this;
        return availableLabels.findBy('slug', label);
    }

    get labelModalData() {
        let label = this.modalLabel;
        let labels = this.availableLabels;

        return {
            label,
            labels
        };
    }

    get selectedPaidParam() {
        return this.paidParams.findBy('value', this.paidParam) || {value: '!unknown'};
    }

    // Actions -----------------------------------------------------------------

    @action
    refreshData() {
        this.fetchMembersTask.perform();
        this.fetchLabelsTask.perform();
        this.membersStats.invalidate();
        this.membersStats.fetch();
    }

    @action
    changeOrder(order) {
        this.orderParam = order.value;
    }

    @action
    search(e) {
        this.searchTask.perform(e.target.value);
    }

    @action
    exportData() {
        let exportUrl = ghostPaths().url.api('members/upload');
        let downloadParams = new URLSearchParams();
        downloadParams.set('limit', 'all');
        if (this.paidParam !== null) {
            downloadParams.set('paid', this.paidParam);
        }
        if (this.label !== null) {
            downloadParams.set('filter', `label:${this.label}`);
        }
        if (this.searchText !== '') {
            downloadParams.set('search', this.searchText);
        }
        let iframe = document.getElementById('iframeDownload');

        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'iframeDownload';
            iframe.style.display = 'none';
            document.body.append(iframe);
        }
        iframe.setAttribute('src', `${exportUrl}?${downloadParams.toString()}`);
    }

    @action
    changeLabel(label, e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        this.label = label.slug;
    }

    @action
    addLabel(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const newLabel = this.store.createRecord('label');
        this.modalLabel = newLabel;
        this.showLabelModal = !this.showLabelModal;
    }

    @action
    editLabel(label, e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        let modalLabel = this.availableLabels.findBy('slug', label);
        this.modalLabel = modalLabel;
        this.showLabelModal = !this.showLabelModal;
    }

    @action
    toggleLabelModal() {
        this.showLabelModal = !this.showLabelModal;
    }

    @action
    changePaidParam(paid) {
        this.paidParam = paid.value;
    }

    @action
    toggleDeleteMembersModal() {
        this.showDeleteMembersModal = !this.showDeleteMembersModal;
    }

    @action
    deleteMembers() {
        return this.deleteMembersTask.perform();
    }

    // Tasks -------------------------------------------------------------------

    @task({restartable: true})
    *searchTask(query) {
        yield timeout(250); // debounce
        this.searchParam = query;
    }

    @task
    *fetchLabelsTask() {
        yield this.store.query('label', {limit: 'all'});
    }

    @task({restartable: true})
    *fetchMembersTask(params) {
        // params is undefined when called as a "refresh" of the model
        let {label, paidParam, searchParam, orderParam} = typeof params === 'undefined' ? this : params;

        if (!searchParam) {
            this.resetSearch();
        }

        // use a fixed created_at date so that subsequent pages have a consistent index
        let startDate = new Date();

        // bypass the stale data shortcut if params change
        let forceReload = !params
            || label !== this._lastLabel
            || paidParam !== this._lastPaidParam
            || searchParam !== this._lastSearchParam
            || orderParam !== this._orderParam;
        this._lastLabel = label;
        this._lastPaidParam = paidParam;
        this._lastSearchParam = searchParam;
        this._lastOrderParam = orderParam;

        // unless we have a forced reload, do not re-fetch the members list unless it's more than a minute old
        // keeps navigation between list->details->list snappy
        if (!forceReload && this._startDate && !(this._startDate - startDate > 1 * 60 * 1000)) {
            return this.members;
        }

        this._startDate = startDate;

        this.members = yield this.ellaSparse.array((range = {}, query = {}) => {
            const labelFilter = label ? `label:'${label}'+` : '';
            const paidQuery = paidParam ? {paid: paidParam} : {};
            const searchQuery = searchParam ? {search: searchParam} : {};
            const order = orderParam ? `${orderParam} desc` : `created_at desc`;

            query = Object.assign({
                order,
                limit: range.length,
                page: range.page,
                filter: `${labelFilter}created_at:<='${moment.utc(this._startDate).format('YYYY-MM-DD HH:mm:ss')}'`
            }, paidQuery, searchQuery, query);

            return this.store.query('member', query).then((result) => {
                return {
                    data: result,
                    total: result.meta.pagination.total
                };
            });
        }, {
            limit: 50
        });
    }

    @task({drop: true})
    *deleteMembersTask() {
        let {label, paidParam, searchParam} = this;

        let filter = label ? `label:${label}` : '';
        let paidQuery = paidParam ? {paid: paidParam} : {};
        let searchQuery = searchParam ? {search: searchParam} : {};
        let allQuery = !label && !paidParam && !searchParam ? {all: true} : {};

        let query = new URLSearchParams(Object.assign({}, {filter}, paidQuery, searchQuery, allQuery));
        let url = `${this.ghostPaths.url.api('members')}?${query}`;

        // response contains details of which members failed to be deleted
        let response = yield this.ajax.del(url);

        // reset and reload
        this.store.unloadAll('member');
        this.reload();

        return response.meta.stats;
    }

    // Internal ----------------------------------------------------------------

    resetSearch() {
        this.searchText = '';
    }

    reload() {
        this.membersStats.invalidate();
        this.membersStats.fetch();
        this.fetchMembersTask.perform();
    }
}
