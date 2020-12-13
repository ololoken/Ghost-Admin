import ModalComponent from 'ghost-admin/components/modal-base';
import ghostPaths from 'ghost-admin/utils/ghost-paths';
import moment from 'moment';
import unparse from '@tryghost/members-csv/lib/unparse';
import {
    AcceptedResponse,
    isRequestEntityTooLargeError,
    isUnsupportedMediaTypeError,
    isVersionMismatchError
} from 'ghost-admin/services/ajax';
import {computed} from '@ember/object';
import {htmlSafe} from '@ember/string';
import {isBlank} from '@ember/utils';
import {inject as service} from '@ember/service';

export default ModalComponent.extend({
    config: service(),
    ajax: service(),
    notifications: service(),
    store: service(),

    state: 'INIT',

    file: null,
    mappingResult: null,
    mappingFileData: null,
    paramName: 'membersfile',
    importResponse: null,
    errorMessage: null,
    showMappingErrors: false,

    // Allowed actions
    confirm: () => {},

    uploadUrl: computed(function () {
        return `${ghostPaths().apiRoot}/members/upload/`;
    }),

    formData: computed('file', function () {
        let formData = new FormData();

        formData.append(this.paramName, this.file);

        if (this.mappingResult.labels) {
            this.mappingResult.labels.forEach((label) => {
                formData.append('labels', label.name);
            });
        }

        if (this.mappingResult.mapping) {
            let mapping = this.mappingResult.mapping.toJSON();
            for (let [key, val] of Object.entries(mapping)) {
                formData.append(`mapping[${key}]`, val);
            }
        }

        return formData;
    }),

    actions: {
        setFile(file) {
            this.set('file', file);
            this.set('state', 'MAPPING');
        },

        setMappingResult(mappingResult) {
            this.set('mappingResult', mappingResult);
        },

        setMappingFileData(mappingFileData) {
            this.set('mappingFileData', mappingFileData);
        },

        upload() {
            if (this.file && !this.mappingResult.error) {
                this.generateRequest();
                this.set('showMappingErrors', false);
            } else {
                this.set('showMappingErrors', true);
            }
        },

        reset() {
            this.set('showMappingErrors', false);
            this.set('errorMessage', null);
            this.set('file', null);
            this.set('mapping', null);
            this.set('state', 'INIT');
        },

        closeModal() {
            if (this.state !== 'UPLOADING') {
                this._super(...arguments);
            }
        },

        // noop - we don't want the enter key doing anything
        confirm() {}
    },

    generateRequest() {
        let ajax = this.ajax;
        let formData = this.formData;
        let url = this.uploadUrl;

        this.set('state', 'UPLOADING');
        ajax.post(url, {
            data: formData,
            processData: false,
            contentType: false,
            dataType: 'text'
        }).then((importResponse) => {
            if (importResponse instanceof AcceptedResponse) {
                this.set('state', 'PROCESSING');
            } else {
                this._uploadSuccess(JSON.parse(importResponse));
                this.set('state', 'COMPLETE');
            }
        }).catch((error) => {
            this._uploadError(error);
            this.set('state', 'ERROR');
        });
    },

    _uploadSuccess(importResponse) {
        let importedCount = importResponse.meta.stats.imported;
        const erroredMembers = importResponse.meta.stats.invalid;
        let errorCount = erroredMembers.length;
        const errorList = {};

        const errorsWithFormattedMessages = erroredMembers.map((row) => {
            const formattedError = row.error
                .replace(
                    'Value in [members.email] cannot be blank.',
                    'Missing email address'
                )
                .replace(
                    'Value in [members.note] exceeds maximum length of 2000 characters.',
                    'Note is too long'
                )
                .replace(
                    'Value in [members.subscribed] must be one of true, false, 0 or 1.',
                    'Value of "Subscribed to emails" must be "true" or "false"'
                )
                .replace(
                    'Validation (isEmail) failed for email',
                    'Invalid email address'
                )
                .replace(
                    /No such customer:[^,]*/,
                    'Could not find Stripe customer'
                );
            formattedError.split(',').forEach((errorMssg) => {
                if (errorList[errorMssg]) {
                    errorList[errorMssg].count = errorList[errorMssg].count + 1;
                } else {
                    errorList[errorMssg] = {
                        message: errorMssg,
                        count: 1
                    };
                }
            });
            return {
                ...row,
                error: formattedError
            };
        });

        let errorCsv = unparse(errorsWithFormattedMessages);
        let errorCsvBlob = new Blob([errorCsv], {type: 'text/csv'});
        let errorCsvUrl = URL.createObjectURL(errorCsvBlob);
        let errorCsvName = importResponse.meta.import_label ? `${importResponse.meta.import_label.name} - Errors.csv` : `Import ${moment().format('YYYY-MM-DD HH:mm')} - Errors.csv`;

        this.set('importResponse', {
            importedCount,
            errorCount,
            errorCsvUrl,
            errorCsvName,
            errorList: Object.values(errorList)
        });

        // insert auto-created import label into store immediately if present
        // ready for filtering the members list
        if (importResponse.meta.import_label) {
            this.store.pushPayload({
                labels: [importResponse.meta.import_label]
            });
        }

        // invoke the passed in confirm action to refresh member data
        // @TODO wtf does confirm mean?
        this.confirm({label: importResponse.meta.import_label});
    },

    _uploadError(error) {
        let message;

        if (isVersionMismatchError(error)) {
            this.notifications.showAPIError(error);
        }

        if (isUnsupportedMediaTypeError(error)) {
            message = this.intl.t('members.The file type you uploaded is not supported.');
        } else if (isRequestEntityTooLargeError(error)) {
            message = this.intl.t('members.The file you uploaded was larger than the maximum file size your server allows.');
        } else if (error.payload && error.payload.errors && !isBlank(error.payload.errors[0].message)) {
            message = htmlSafe(error.payload.errors[0].message);
        } else {
            console.error(error); // eslint-disable-line
            message = this.intl.t('members.Something went wrong :(');
        }

        this.set('errorMessage', message);
    }
});
