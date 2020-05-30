import Controller from '@ember/controller';
import ghostPaths from 'ghost-admin/utils/ghost-paths';
import {A} from '@ember/array';
import {action} from '@ember/object';
import {alias} from '@ember/object/computed';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency-decorators';
import {timeout} from 'ember-concurrency';
import {tracked} from '@glimmer/tracking';

export default class MembersController extends Controller {
    @service intl;
    @service feature;
    @service store;

    queryParams = ['label', {searchParam: 'search'}];

    @alias('model') members;

    @tracked searchText = '';
    @tracked searchParam = '';
    @tracked label = null;
    @tracked modalLabel = null;
    @tracked showLabelModal = false;

    @tracked _availableLabels = A([]);

    constructor() {
        super(...arguments);
        this._availableLabels = this.store.peekAll('label');
    }

    // Computed properties -----------------------------------------------------

    get listHeader() {
        let {searchText, selectedLabel, members} = this;

        if (members.loading) {
            return 'Loading...';
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
        return !this.searchParam && !this.label;
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

    // Actions -----------------------------------------------------------------

    @action
    search(e) {
        this.searchTask.perform(e.target.value);
    }

    @action
    exportData() {
        let exportUrl = ghostPaths().url.api('members/csv');
        let downloadURL = `${exportUrl}?limit=all`;
        let iframe = document.getElementById('iframeDownload');

        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.id = 'iframeDownload';
            iframe.style.display = 'none';
            document.body.append(iframe);
        }
        iframe.setAttribute('src', downloadURL);
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

    // Tasks -------------------------------------------------------------------

    @task({restartable: true})
    *searchTask(query) {
        yield timeout(250); // debounce
        this.searchParam = query;
    }

    @task
    *fetchLabelsTask() {
        if (!this._hasLoadedLabels) {
            yield this.store.query('label', {limit: 'all'}).then(() => {
                this._hasLoadedLabels = true;
            });
        }
    }

    // Internal ----------------------------------------------------------------

    resetSearch() {
        this.searchText = '';
    }
}
