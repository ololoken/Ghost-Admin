import Component from '@ember/component';
import ShortcutsMixin from 'ghost-admin/mixins/shortcuts';
import ctrlOrCmd from 'ghost-admin/utils/ctrl-or-cmd';
import formatMarkdown from 'ghost-admin/utils/format-markdown';
import {assign} from '@ember/polyfills';
import {computed} from '@ember/object';
import {htmlSafe} from '@ember/template';
import {isEmpty, typeOf} from '@ember/utils';
import {run} from '@ember/runloop';
import {inject as service} from '@ember/service';

/* eslint-disable ghost/ember/no-side-effects */
// bug in eslint-plugin-ember?

export default Component.extend(ShortcutsMixin, {

    config: service(),
    notifications: service(),
    settings: service(),
    intl: service(),

    classNames: ['gh-markdown-editor'],
    classNameBindings: [
        '_isFullScreen:gh-markdown-editor-full-screen',
        '_isSplitScreen:gh-markdown-editor-side-by-side'
    ],

    // Public attributes
    autofocus: false,
    imageMimeTypes: null,
    isFullScreen: false,
    markdown: null,
    options: null,
    placeholder: '',
    showMarkdownHelp: false,
    uploadedImageUrls: null,

    enableSideBySide: true,
    enablePreview: true,
    enableHemingway: true,

    shortcuts: null,

    // Private
    _editor: null,
    _editorFocused: false,
    _isFullScreen: false,
    _isSplitScreen: false,
    _isHemingwayMode: false,
    _isUploading: false,
    _showUnsplash: false,
    _uploadedImageUrls: null,

    // Closure actions
    onChange() {},
    onFullScreenToggle() {},
    onImageFilesSelected() {},
    onPreviewToggle() {},
    onSplitScreenToggle() {},

    simpleMDEOptions: computed('options', function () {
        let options = this.options || {};
        let defaultOptions = {
            // use our Showdown config with sanitization for previews
            previewRender(markdown) {
                return formatMarkdown(markdown);
            },

            // Ghost-specific SimpleMDE toolbar config - allows us to create a
            // bridge between SimpleMDE buttons and Ember actions
            toolbar: [
                {
                    name: 'bold',
                    action: () => this._editor.toggleBold(this._editor),
                    className: 'fa fa-bold',
                    title: `${this.intl.t('editor.button.Bold')} (${ctrlOrCmd}-B)`
                },
                {
                    name: 'italic',
                    action: () => this._editor.toggleItalic(this._editor),
                    className: 'fa fa-italic',
                    title: `${this.intl.t('editor.button.Italic')} (${ctrlOrCmd}-I)`
                },
                {
                    name: 'heading',
                    action: () => this._editor.toggleHeadingSmaller(this._editor),
                    className: 'fa fa-header',
                    title: `${this.intl.t('editor.button.Heading')} (${ctrlOrCmd}-H)`
                },
                '|',
                {
                    name: 'quote',
                    action: () => this._editor.toggleBlockquote(this._editor),
                    className: 'fa fa-quote-left',
                    title: `${this.intl.t('editor.button.Quote')} (${ctrlOrCmd}-')`
                },
                {
                    name: 'unordered-list',
                    action: () => this._editor.toggleUnorderedList(this._editor),
                    className: 'fa fa-list-ul',
                    title: `${this.intl.t('editor.button.Generic List')} (${ctrlOrCmd}-L)`
                },
                {
                    name: 'ordered-list',
                    action: () => this._editor.toggleOrderedList(this._editor),
                    className: 'fa fa-list-ol',
                    title: `${this.intl.t('editor.button.Numbered List')} (${ctrlOrCmd}-Alt-L)`
                },
                '|',
                {
                    name: 'link',
                    action: () => this._editor.drawLink(this._editor),
                    className: 'fa fa-link',
                    title: `${this.intl.t('editor.button.Create Link')} (${ctrlOrCmd}-K)`
                },
                {
                    name: 'image',
                    action: () => {
                        this._openImageFileDialog();
                    },
                    className: 'fa fa-picture-o',
                    title: `${this.intl.t('editor.button.Upload Image(s)')} (${ctrlOrCmd}-Shift-I)`
                },
                '|',
                {
                    name: 'preview',
                    action: () => {
                        this._togglePreview();
                    },
                    className: 'fa fa-eye no-disable',
                    title: `${this.intl.t('editor.button.Render Preview')} (${ctrlOrCmd}-Alt-R)`
                },
                {
                    name: 'side-by-side',
                    action: () => {
                        this.send('toggleSplitScreen');
                    },
                    className: 'fa fa-columns no-disable no-mobile',
                    title: `${this.intl.t('editor.button.Side-by-side Preview')} (${ctrlOrCmd}-Alt-P)`
                },
                '|',
                {
                    name: 'spellcheck',
                    action: () => {
                        this._toggleSpellcheck();
                    },
                    className: 'fa fa-check',
                    title: `${this.intl.t('editor.button.Spellcheck')} (${ctrlOrCmd}-Alt-S)`
                },
                {
                    name: 'hemingway',
                    action: () => {
                        this._toggleHemingway();
                    },
                    className: 'fa fa-h-square',
                    title: `${this.intl.t('editor.button.Hemingway Mode')} (${ctrlOrCmd}-Alt-H)`
                },
                {
                    name: 'guide',
                    action: () => {
                        this.send('toggleMarkdownHelp');
                    },
                    className: 'fa fa-question-circle',
                    title: this.intl.t('editor.button.Markdown Guide')
                }
            ],

            // disable shortcuts for side-by-side and fullscreen because they
            // trigger interal SimpleMDE methods that will result in broken
            // layouts
            shortcuts: {
                toggleFullScreen: null,
                togglePreview: null,
                toggleSideBySide: null,
                drawImage: null
            },

            // only include the number of words in the status bar
            status: ['words']
        };

        let toolbar = defaultOptions.toolbar;

        if (!this.enableSideBySide) {
            let sideBySide = toolbar.findBy('name', 'side-by-side');
            let index = toolbar.indexOf(sideBySide);
            toolbar.splice(index, 1);
        }

        if (!this.enablePreview) {
            let preview = toolbar.findBy('name', 'preview');
            let index = toolbar.indexOf(preview);
            toolbar.splice(index, 1);
        }

        if (!this.enableHemingway) {
            let hemingway = toolbar.findBy('name', 'hemingway');
            let index = toolbar.indexOf(hemingway);
            toolbar.splice(index, 1);
        }

        if (this.get('settings.unsplash')) {
            let image = toolbar.findBy('name', 'image');
            let index = toolbar.indexOf(image) + 1;

            toolbar.splice(index, 0, {
                name: 'unsplash',
                action: () => {
                    this.send('toggleUnsplash');
                },
                className: 'fa fa-camera',
                title: `${this.intl.t('editor.button.Add Image from Unsplash')} (${ctrlOrCmd}-Shift-U)`
            });
        }

        let lastItem = null;
        toolbar.forEach((item, index) => {
            if (item === '|' && item === lastItem) {
                toolbar[index] = null;
            }
            lastItem = item;
        });
        defaultOptions.toolbar = toolbar.filter(Boolean).map((item) => {
            if (item.title) {
                item.title = item.title
                    .replace(/command/, '⌘')
                    .replace(/ctrl/, 'Ctrl');
            }
            return item;
        });

        return assign(defaultOptions, options);
    }),

    init() {
        this._super(...arguments);
        //once we received translated placeholder it's SafeString; cast it to String as required by simplemde
        this.set('placeholder', this.get('placeholder').toString());
        let shortcuts = {};
        shortcuts[`${ctrlOrCmd}+shift+i`] = {action: 'openImageFileDialog'};
        shortcuts[`${ctrlOrCmd}+shift+u`] = {action: 'toggleUnsplash'};
        shortcuts[`${ctrlOrCmd}+alt+s`] = {action: 'toggleSpellcheck'};

        if (this.enablePreview) {
            shortcuts[`${ctrlOrCmd}+alt+r`] = {action: 'togglePreview'};
        }
        if (this.enableSideBySide) {
            shortcuts[`${ctrlOrCmd}+alt+p`] = {action: 'toggleSplitScreen'};
        }
        if (this.enableHemingway) {
            shortcuts[`${ctrlOrCmd}+alt+h`] = {action: 'toggleHemingway'};
        }

        this.shortcuts = shortcuts;
    },

    // extract markdown content from single markdown card
    didReceiveAttrs() {
        this._super(...arguments);

        let uploadedImageUrls = this.uploadedImageUrls;
        if (!isEmpty(uploadedImageUrls) && uploadedImageUrls !== this._uploadedImageUrls) {
            this._uploadedImageUrls = uploadedImageUrls;

            // must be done afterRender to avoid double modify of mobiledoc in a single render
            run.scheduleOnce('afterRender', this, this._insertImages, uploadedImageUrls);
        }

        // focus the editor when the markdown value changes, this is necessary
        // because both the autofocus and markdown values can change without a
        // re-render, eg. navigating from edit->new
        if (this.autofocus && this._editor && this.markdown !== this._editor.value()) {
            this.send('focusEditor');
        }

        // use internal values to avoid updating bound values
        if (!isEmpty(this.isFullScreen)) {
            this.set('_isFullScreen', this.isFullScreen);
        }
        if (!isEmpty(this.isSplitScreen)) {
            this.set('_isSplitScreen', this.isSplitScreen);
        }

        this._updateButtonState();
    },

    didInsertElement() {
        this._super(...arguments);
        this.registerShortcuts();

        // HACK: iOS will scroll the body up when activating the keyboard, this
        // causes problems in the CodeMirror based editor because iOS doesn't
        // scroll the cursor and other measurement elements which results in
        // rather unfriendly behaviour with text appearing in seemingly random
        // places and an inability to select things properly
        //
        // To get around this we use a raf loop that constantly makes sure the
        // body scrollTop is 0 when the editor is on screen
        let iOS = !!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform);
        if (iOS) {
            this._preventBodyScroll();
        }
    },

    willDestroyElement() {
        if (this._isSplitScreen) {
            this._disconnectSplitPreview();
        }

        this.removeShortcuts();

        this._super(...arguments);

        if (this._preventBodyScrollId) {
            window.cancelAnimationFrame(this._preventBodyScrollId);
        }
    },

    actions: {
        // trigger external update, any mobiledoc updates are handled there
        updateMarkdown(markdown) {
            this.onChange(markdown);
        },

        // store a reference to the simplemde editor so that we can handle
        // focusing and image uploads
        setEditor(editor) {
            this._editor = editor;

            // disable CodeMirror's drag/drop handling as we want to handle that
            // in the parent gh-editor component
            this._editor.codemirror.setOption('dragDrop', false);

            // default to spellchecker being off
            this._editor.codemirror.setOption('mode', 'gfm');

            // add non-breaking space as a special char
            // eslint-disable-next-line no-control-regex
            this._editor.codemirror.setOption('specialChars', /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff\xa0]/g);

            // HACK: move the toolbar & status bar elements outside of the
            // editor container so that they can be aligned in fixed positions
            let container = this.element.closest('.gh-editor');
            let footer = container && container.querySelector('.gh-editor-footer');
            if (footer) {
                this._toolbar = this.element.querySelector('.editor-toolbar');
                this._statusbar = this.element.querySelector('.editor-statusbar');
                this._statusbar.querySelector('.words').dataset.content = this.intl.t('editor.words');
                footer.appendChild(this._toolbar);
                footer.appendChild(this._statusbar);
            }

            this._updateButtonState();
        },

        // used by the title input when the TAB or ENTER keys are pressed
        focusEditor(position = 'bottom') {
            this._editor.codemirror.focus();

            if (position === 'bottom') {
                this._editor.codemirror.execCommand('goDocEnd');
            } else if (position === 'top') {
                this._editor.codemirror.execCommand('goDocStart');
            }

            return false;
        },

        // HACK FIXME (PLEASE):
        // - clicking toolbar buttons will cause the editor to lose focus
        // - this is painful because we often want to know if the editor has focus
        //   so that we can insert images and so on in the correct place
        // - the blur event will always fire before the button action is triggered 😞
        // - to work around this we track focus state manually and set it to false
        //   after an arbitrary period that's long enough to allow the button action
        //   to trigger first
        // - this _may_ well have unknown issues due to browser differences,
        //   variations in performance, moon cycles, sun spots, or cosmic rays
        // - here be 🐲
        // - (please let it work 🙏)
        updateFocusState(focused) {
            if (focused) {
                this._editorFocused = true;
            } else {
                run.later(this, function () {
                    this._editorFocused = false;
                }, 100);
            }
        },

        openImageFileDialog() {
            let captureSelection = this._editor.codemirror.hasFocus();
            this._openImageFileDialog({captureSelection});
        },

        toggleUnsplash() {
            if (this._showUnsplash) {
                return this.toggleProperty('_showUnsplash');
            }

            // capture current selection before it's lost by clicking toolbar btn
            if (this._editorFocused) {
                this._imageInsertSelection = {
                    anchor: this._editor.codemirror.getCursor('anchor'),
                    head: this._editor.codemirror.getCursor('head')
                };
            }

            this.toggleProperty('_showUnsplash');
        },

        insertUnsplashPhoto({src, alt, caption}) {
            let image = {
                alt,
                url: src,
                credit: `<small>${caption}</small>`
            };

            this._insertImages([image]);
        },

        togglePreview() {
            this._togglePreview();
        },

        toggleFullScreen() {
            let isFullScreen = !this._isFullScreen;

            this.set('_isFullScreen', isFullScreen);
            this._updateButtonState();
            this.onFullScreenToggle(isFullScreen);

            // leave split screen when exiting full screen mode
            if (!isFullScreen && this._isSplitScreen) {
                this.send('toggleSplitScreen');
            }
        },

        toggleSplitScreen() {
            let isSplitScreen = !this._isSplitScreen;
            let previewButton = this._editor.toolbarElements.preview;

            this.set('_isSplitScreen', isSplitScreen);
            this._updateButtonState();

            // set up the preview rendering and scroll sync
            // afterRender is needed so that necessary components have been
            // added/removed and editor pane length has settled
            if (isSplitScreen) {
                // disable the normal SimpleMDE preview if it's active
                if (this._editor.isPreviewActive()) {
                    let preview = this._editor.toolbar.find(button => button.name === 'preview');

                    preview.action(this._editor);
                }

                if (previewButton) {
                    previewButton.classList.add('disabled');
                }

                run.scheduleOnce('afterRender', this, this._connectSplitPreview);
            } else {
                if (previewButton) {
                    previewButton.classList.remove('disabled');
                }

                run.scheduleOnce('afterRender', this, this._disconnectSplitPreview);
            }

            this.onSplitScreenToggle(isSplitScreen);

            // go fullscreen when entering split screen mode
            this.send('toggleFullScreen');
        },

        toggleSpellcheck() {
            this._toggleSpellcheck();
        },

        toggleHemingway() {
            this._toggleHemingway();
        },

        toggleMarkdownHelp() {
            this.toggleProperty('showMarkdownHelp');
        }
    },

    _preventBodyScroll() {
        this._preventBodyScrollId = window.requestAnimationFrame(() => {
            let body = document.querySelector('body');

            // only scroll the editor if the editor is active so that we don't
            // clobber scroll-to-input behaviour in the PSM
            if (document.activeElement.closest('.CodeMirror')) {
                if (body.scrollTop !== 0) {
                    let editor = document.querySelector('.gh-markdown-editor');

                    // scroll the editor by the same amount the body has been scrolled,
                    // this should keep the cursor on screen when opening the keyboard
                    editor.scrollTop += body.scrollTop;
                    body.scrollTop = 0;
                }
            }

            this._preventBodyScroll();
        });
    },

    _insertImages(urls) {
        let cm = this._editor.codemirror;

        // loop through urls and generate image markdown
        let images = urls.map((url) => {
            // plain url string, so extract filename from path
            if (typeOf(url) === 'string') {
                let filename = url.split('/').pop();
                let alt = filename;

                // if we have a normal filename.ext, set alt to filename -ext
                if (filename.lastIndexOf('.') > 0) {
                    alt = filename.slice(0, filename.lastIndexOf('.'));
                }

                return `![${alt}](${url})`;

            // full url object, use attrs we're given
            } else {
                let image = `![${url.alt}](${url.url})`;

                if (url.credit) {
                    image += `\n${url.credit}`;
                }

                return image;
            }
        });
        let text = images.join('\n\n');

        // clicking the image toolbar button will lose the selection so we use
        // the captured selection to re-select here
        if (this._imageInsertSelection) {
            // we want to focus but not re-position
            this.send('focusEditor', null);

            // re-select and clear the captured selection so drag/drop still
            // inserts at the correct place
            cm.setSelection(
                this._imageInsertSelection.anchor,
                this._imageInsertSelection.head
            );
            this._imageInsertSelection = null;
        }

        // focus editor and place cursor at end if not already focused
        if (!cm.hasFocus()) {
            this.send('focusEditor');
            text = `\n\n${text}\n\n`;
        }

        // insert at cursor or replace selection then position cursor at end
        // of inserted text
        cm.replaceSelection(text, 'end');
    },

    // mark the split-pane/full-screen/spellcheck buttons active when they're active
    _updateButtonState() {
        if (this._editor) {
            let sideBySideButton = this._editor.toolbarElements['side-by-side'];
            let spellcheckButton = this._editor.toolbarElements.spellcheck;
            let hemingwayButton = this._editor.toolbarElements.hemingway;

            if (sideBySideButton) {
                if (this._isSplitScreen) {
                    sideBySideButton.classList.add('active');
                } else {
                    sideBySideButton.classList.remove('active');
                }
            }

            if (spellcheckButton) {
                if (this._editor.codemirror.getOption('mode') === 'spell-checker') {
                    spellcheckButton.classList.add('active');
                } else {
                    spellcheckButton.classList.remove('active');
                }
            }

            if (hemingwayButton) {
                if (this._isHemingwayMode) {
                    hemingwayButton.classList.add('active');
                } else {
                    hemingwayButton.classList.remove('active');
                }
            }
        }
    },

    // set up the preview auto-update and scroll sync
    _connectSplitPreview() {
        let cm = this._editor.codemirror;
        let editor = this._editor;
        let editorPane = this.element.querySelector('.gh-markdown-editor-pane');
        let previewPane = this.element.querySelector('.gh-markdown-editor-preview');
        let previewContent = this.element.querySelector('.gh-markdown-editor-preview-content');

        this._editorPane = editorPane;
        this._previewPane = previewPane;
        this._previewContent = previewContent;

        // from SimpleMDE -------
        let sideBySideRenderingFunction = function () {
            previewContent.innerHTML = editor.options.previewRender(
                editor.value(),
                previewContent
            );
        };

        cm.sideBySideRenderingFunction = sideBySideRenderingFunction;

        sideBySideRenderingFunction();
        cm.on('update', cm.sideBySideRenderingFunction);

        // Refresh to fix selection being off (#309)
        cm.refresh();
        // ----------------------

        this._onEditorPaneScroll = this._scrollHandler.bind(this);
        editorPane.addEventListener('scroll', this._onEditorPaneScroll, false);
        this._scrollSync();
    },

    _scrollHandler() {
        if (!this._scrollSyncTicking) {
            requestAnimationFrame(this._scrollSync.bind(this));
        }
        this._scrollSyncTicking = true;
    },

    _scrollSync() {
        let editorPane = this._editorPane;
        let previewPane = this._previewPane;
        let height = editorPane.scrollHeight - editorPane.clientHeight;
        let ratio = parseFloat(editorPane.scrollTop) / height;
        let move = (previewPane.scrollHeight - previewPane.clientHeight) * ratio;

        previewPane.scrollTop = move;
        this._scrollSyncTicking = false;
    },

    _disconnectSplitPreview() {
        let cm = this._editor.codemirror;

        cm.off('update', cm.sideBySideRenderingFunction);
        cm.refresh();

        this._editorPane.removeEventListener('scroll', this._onEditorPaneScroll, false);
        delete this._previewPane;
        delete this._previewPaneContent;
        delete this._onEditorPaneScroll;
    },

    _openImageFileDialog({captureSelection = true} = {}) {
        if (captureSelection) {
            // capture the current selection before it's lost by clicking the
            // file input button
            this._imageInsertSelection = {
                anchor: this._editor.codemirror.getCursor('anchor'),
                head: this._editor.codemirror.getCursor('head')
            };
        }

        // trigger the dialog via gh-file-input, when a file is selected it will
        // trigger the onImageFilesSelected closure action
        this.element.querySelector('input[type="file"]').click();
    },

    // wrap SimpleMDE's built-in preview toggle so that we can trigger a closure
    // action that can apply our own classes higher up in the DOM
    _togglePreview() {
        this.onPreviewToggle(!this._editor.isPreviewActive());
        this._editor.togglePreview();
    },

    _toggleSpellcheck() {
        let cm = this._editor.codemirror;

        if (cm.getOption('mode') === 'spell-checker') {
            cm.setOption('mode', 'gfm');
        } else {
            cm.setOption('mode', 'spell-checker');
        }

        this._updateButtonState();
    },

    _toggleHemingway() {
        let cm = this._editor.codemirror;
        let extraKeys = cm.getOption('extraKeys');
        let notificationText = '';

        this._isHemingwayMode = !this._isHemingwayMode;

        if (this._isHemingwayMode) {
            notificationText = `<span class="gh-notification-title">${this.intl.t('editor.notice.Hemingway Mode On')}:</span> ${this.intl.t('editor.notice.Write now; edit later. Backspace disabled.')}`;
            extraKeys.Backspace = function () {};
        } else {
            notificationText = `<span class="gh-notification-title">${this.intl.t('editor.notice.Hemingway Mode Off')}:</span> ${this.intl.t('editor.notice.Normal editing restored.')}`;
            delete extraKeys.Backspace;
        }

        cm.setOption('extraKeys', extraKeys);
        this._updateButtonState();

        cm.focus();

        this.notifications.showNotification(
            htmlSafe(notificationText),
            {key: 'editor.hemingwaymode'}
        );
    }
});
