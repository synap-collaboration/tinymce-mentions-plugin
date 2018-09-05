/*global tinymce, module, require, define, global, self */

;(function (f) {
  'use strict';

  // CommonJS
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = f(require('jquery'));

  // RequireJS
  } else if (typeof define === 'function'  && define.amd) {
    define(['jquery'], f);

  // <script>
  } else {
    var g;
    if (typeof window !== 'undefined') {
      g = window;
    } else if (typeof global !== 'undefined') {
      g = global;
    } else if (typeof self !== 'undefined') {
      g = self;
    } else {
      g = this;
    }
    
    f(g.jQuery);
  }

})(function ($) {
    'use strict';

    const mentionIds = [];

    var AutoComplete = function (ed, options) {
        this.editor = ed;

        this.beginId = tinymce.DOM.uniqueId();
        this.endId = tinymce.DOM.uniqueId();

        this.options = $.extend({}, {
            source: [],
            delay: 500,
            queryBy: 'name',
            items: 10
        }, options);

        this.options.insertFrom = this.options.insertFrom || this.options.queryBy;

        this.matcher = this.options.matcher || this.matcher;
        this.sorter = this.options.sorter || this.sorter;
        this.renderDropdown = this.options.renderDropdown || this.renderDropdown;
        this.render = this.options.render || this.render;
        this.insert = this.options.insert || this.insert;

        this.query = '';
        this.hasFocus = true;

        this.renderInput();

        this.bindEvents();
        this.lookup();
    };

    AutoComplete.prototype = {

        constructor: AutoComplete,

        renderInput: function () {
            var rawHtml =  '<span id="autocomplete">' +
                                '<span id="autocomplete-delimiter">' + this.options.delimiter + '</span>' +
                                '<span id="autocomplete-searchtext"><span class="dummy">\uFEFF</span></span>' +
                            '</span>';

            this.editor.execCommand('mceInsertContent', false, rawHtml);
            this.editor.focus();
            this.editor.selection.select(this.editor.selection.dom.select('span#autocomplete-searchtext span')[0]);
            this.editor.selection.collapse(0);
        },

        bindEvents: function () {
            this.editor.on('keyup', this.editorKeyUpProxy = $.proxy(this.rteKeyUp, this));
            this.editor.on('keydown', this.editorKeyDownProxy = $.proxy(this.rteKeyDown, this), true);
            this.editor.on('click', this.editorClickProxy = $.proxy(this.rteClicked, this));

            $('body').on('click', this.bodyClickProxy = $.proxy(this.rteLostFocus, this));

            $(document).on('mouseenter', "li.mentions-menu-suggestion", (e) => {
                if (this.$dropdown !== undefined) {
                    this.$dropdown.find('li.mentions-menu-suggestion.active').removeClass('active');
                }
                // Sometimes there's weird behavior where the innerHTML of the li element is selected, hence this check
                if (e.target.nodeName === 'LI'){
                    e.target.classList.add('active');
                }
            });

            $(this.editor.getWin()).on('scroll', this.rteScroll = $.proxy(function () { this.cleanUp(true); }, this));
        },

        unbindEvents: function () {
            this.editor.off('keyup', this.editorKeyUpProxy);
            this.editor.off('keydown', this.editorKeyDownProxy);
            this.editor.off('click', this.editorClickProxy);

            $('body').off('click', this.bodyClickProxy);

            $(this.editor.getWin()).off('scroll', this.rteScroll);
        },

        rteKeyUp: function (e) {
            switch (e.which || e.keyCode) {
            //DOWN ARROW
            case 40:
            //UP ARROW
            case 38:
            //SHIFT
            case 16:
            //CTRL
            case 17:
            //ALT
            case 18:
                break;

            //BACKSPACE
            case 8:
                if (this.query === '') {
                    this.cleanUp(true);
                } else {
                    this.lookup();
                }
                break;

            //TAB
            case 9:
            //ENTER
            case 13:
                var item = (this.$dropdown !== undefined) ? this.$dropdown.find('li.active') : [];
                if (item.length) {
                    this.select(item.data());
                    this.cleanUp(false);
                } else {
                    this.cleanUp(true);
                }
                break;

            //ESC
            case 27:
                this.cleanUp(true);
                break;

            default:
                this.lookup();
            }
        },

        rteKeyDown: function (e) {
            switch (e.which || e.keyCode) {
             //TAB
            case 9:
            //ENTER
            case 13:
            //ESC
            case 27:
                e.preventDefault();
                break;

            //UP ARROW
            case 38:
                e.preventDefault();
                if (this.$dropdown !== undefined) {
                    this.highlightPreviousResult();
                }
                break;
            //DOWN ARROW
            case 40:
                e.preventDefault();
                if (this.$dropdown !== undefined) {
                    this.highlightNextResult();
                }
                break;
            }

            e.stopPropagation();
        },

        rteClicked: function (e) {
            console.log('rteClicked');
            var $target = $(e.target);

            if (this.hasFocus && $target.parent().attr('id') !== 'autocomplete-searchtext') {
                this.cleanUp(true);
            }
        },

        rteLostFocus: function () {
            console.log('rteLostFocus');
            if (this.hasFocus) {
                this.cleanUp(true);
            }
        },

        lookup: function () {
            this.query = $.trim($(this.editor.getBody()).find('#autocomplete-searchtext').text()).replace('\ufeff', '');

            if (this.$dropdown === undefined) {
                this.show();
            }

            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout($.proxy(function () {
                // Added delimiter parameter as last argument for backwards compatibility.
                var items = $.isFunction(this.options.source) ? this.options.source(this.query, $.proxy(this.process, this), this.options.delimiter) : this.options.source;
                if (items) {
                    this.process(items);
                }
            }, this), this.options.delay);
        },

        matcher: function (item) {
            return ~item[this.options.insertFrom].toLowerCase().indexOf(this.query.toLowerCase());
        },

        sorter: function (items) {
            var beginswith = [],
                caseSensitive = [],
                caseInsensitive = [],
                item;

            while ((item = items.shift()) !== undefined) {
                if (!item[this.options.insertFrom].toLowerCase().indexOf(this.query.toLowerCase())) {
                    beginswith.push(item);
                } else if (~item[this.options.insertFrom].indexOf(this.query)) {
                    caseSensitive.push(item);
                } else {
                    caseInsensitive.push(item);
                }
            }

            return beginswith.concat(caseSensitive, caseInsensitive);
        },

        show: function () {
            var offset = this.editor.inline ? this.offsetInline() : this.offset();

            this.$dropdown = $(this.renderDropdown())
                                .css({ 'top': offset.top, 'left': offset.left });

            $('body').append(this.$dropdown);

            this.$dropdown.on('click', $.proxy(this.autoCompleteClick, this));
        },

        process: function (data) {
            if (!this.hasFocus) {
                return;
            }

            var _this = this,
                result = [],
                items = $.grep(data, function (item) {
                    return _this.matcher(item);
                });

            items = _this.sorter(items);

            items = items.slice(0, this.options.items);

            $.each(items, function (i, item) {
                const $element = $(_this.render(item, i));

                $.each(items[i], function (key, val) {
                    $element.attr('data-' + key, val);
                });

                result.push($element[0].outerHTML);
            });

            if (result.length) {
                this.$dropdown.html(result.join('')).show();
            } else {
                this.$dropdown.hide();
                this.$dropdown.find('li').removeClass('active');
            }

            this.highlightNextResult();
        },

        renderDropdown: function () {
            return '<ul class="rte-autocomplete dropdown-menu"><li class="loading"></li></ul>';
        },

        render: function (item, index) {
            return '<li>' +
                        '<a href="javascript:;"><span>' + item[this.options.insertFrom] + '</span></a>' +
                    '</li>';
        },

        autoCompleteClick: function (e) {
            var item = $(e.target).closest('li').data();
            if (!$.isEmptyObject(item)) {
                this.select(item);
                this.cleanUp(false);
            }
            e.stopPropagation();
            e.preventDefault();
        },

        highlightPreviousResult: function () {
            var currentIndex = this.$dropdown.find('li.active').index(),
                index = (currentIndex === 0) ? this.$dropdown.find('li').length - 1 : --currentIndex;

            this.$dropdown.find('li').removeClass('active').eq(index).addClass('active');
        },

        highlightNextResult: function () {
            var currentIndex = this.$dropdown.find('li.active').index(),
                index = (currentIndex === this.$dropdown.find('li').length - 1) ? 0 : ++currentIndex;

            this.$dropdown.find('li').removeClass('active').eq(index).addClass('active');
        },

        select: function (item) {
            this.editor.focus();
            var selection = this.editor.dom.select('span#autocomplete')[0];
            this.editor.dom.remove(selection);
            mentionIds.push(item.id)
            this.editor.execCommand('mceInsertContent', false, this.insert(item));
        },

        insert: function (item) {
            return '<span>' + item[this.options.insertFrom] + '</span>&nbsp;';
        },

        cleanUp: function (rollback) {
            console.log('cleanUp');
            this.unbindEvents();
            this.hasFocus = false;

            if (this.$dropdown !== undefined) {
                this.$dropdown.remove();
                delete this.$dropdown;
            }

            if (rollback) {
                var text = this.query,
                    $selection = $(this.editor.dom.select('span#autocomplete'));

                if (!$selection.length) {
                    return;
                }
                    
                var replacement = $('<p>' + this.options.delimiter + text + '</p>')[0].firstChild,
                    focus = $(this.editor.selection.getNode()).offset().top === ($selection.offset().top + (($selection.outerHeight() - $selection.height()) / 2));

                this.editor.dom.replace(replacement, $selection[0]);

                if (focus) {
                    this.editor.selection.select(replacement);
                    this.editor.selection.collapse();
                }
            }
        },

        offset: function () {
            var rtePosition = $(this.editor.getContainer()).offset(),
                contentAreaPosition = $(this.editor.getContentAreaContainer()).position(),
                nodePosition = $(this.editor.dom.select('span#autocomplete')).position();

            return {
                top: rtePosition.top + contentAreaPosition.top + nodePosition.top + $(this.editor.selection.getNode()).innerHeight() - $(this.editor.getDoc()).scrollTop() + 5,
                left: rtePosition.left + contentAreaPosition.left + nodePosition.left
            };
        },

        offsetInline: function () {
            var nodePosition = $(this.editor.dom.select('span#autocomplete')).offset();

            return {
                top: nodePosition.top + $(this.editor.selection.getNode()).innerHeight() + 5,
                left: nodePosition.left
            };
        }

    };

    function prevCharIsSpace(ed) {
        var start = ed.selection.getRng(true).startOffset,
              text = ed.selection.getRng(true).startContainer.data || '',
              character = text.substr(start > 0 ? start - 1 : 0, 1);

        return (!!$.trim(character).length) ? false : true;
    }

    function handleKeyPress(e, input, ed, autoComplete, autoCompleteData, clicked) {
        var delimiterIndex = $.inArray(input, autoCompleteData.delimiter);
        if (delimiterIndex > -1 && prevCharIsSpace(ed)) {
            if (autoComplete === undefined || (autoComplete.hasFocus !== undefined && !autoComplete.hasFocus)) {
                e.preventDefault();
                if (clicked) {
                    e.stopPropagation();
                }

                // Clone options object and set the used delimiter.
                autoComplete = new AutoComplete(ed, $.extend({}, autoCompleteData, { delimiter: autoCompleteData.delimiter[delimiterIndex] }));
            }
        } else if (mentionIds.length > 0) {
            const start = tinymce.activeEditor.selection.getStart();
            const isMention = mentionIds.some(id => start.attributes && start.attributes[`data-id-${id}`])
            
            if (isMention) {
                const pTag = start.parentNode;
                let startNodeIndex = 0;
                for (let i = 0; i < pTag.childNodes.length; i++) {
                    if (pTag.childNodes[i] === start) {
                        startNodeIndex = i;
                        break;
                    }
                }

                const range = tinymce.activeEditor.selection.getRng();
                if (range.startOffset == 0 && pTag.childNodes[startNodeIndex] == start) {
                    pTag.innerHTML = `&nbsp;${pTag.innerHTML}`;
                    tinymce.activeEditor.selection.setCursorLocation(pTag.childNodes[startNodeIndex]);
                } else if (range.endOffset == start.innerHTML.length && pTag.childNodes[startNodeIndex] == start) {
                    pTag.innerHTML = `${pTag.innerHTML}&nbsp;`;
                    tinymce.activeEditor.selection.setCursorLocation(pTag.childNodes[startNodeIndex + 1], 1);
                } else {
                    e.preventDefault();
                }
            }
        }
    };

    tinymce.create('tinymce.plugins.SynapMention', {

        init: function (ed) {

            var autoComplete,
                autoCompleteData = ed.getParam('mentions');

            // If the delimiter is undefined set default value to ['@'].
            // If the delimiter is a string value convert it to an array. (backwards compatibility)
            autoCompleteData.delimiter = (autoCompleteData.delimiter !== undefined) ? !$.isArray(autoCompleteData.delimiter) ? [autoCompleteData.delimiter] : autoCompleteData.delimiter : ['@'];

            ed.on('keydown', function (e) {
                switch (e.which || e.keyCode) {
                    case 8:
                        const selection = tinymce.activeEditor.selection.getRng().startContainer.parentNode;
                        mentionIds.some(id => {
                            if (selection.attributes[`data-id-${id}`]) {
                                selection.remove()
                                return true;
                            }
                        });
                        break;
                }
            });

            ed.on('keypress', function (e) {
                handleKeyPress(e, String.fromCharCode(e.which || e.keyCode), ed, autoComplete, autoCompleteData);
            });

            ed.addButton('mention-button', {
                title: '@',
                text: '@',
                onClick: (e) => { handleKeyPress(e, '@', ed, autoComplete, autoCompleteData, true) }
            });
        },

        getInfo: function () {
            return {
                longname: 'synap-mention',
                author: 'Jesse Cooper',
                version: tinymce.majorVersion + '.' + tinymce.minorVersion
            };
        }
    });

    tinymce.PluginManager.add('synap-mention', tinymce.plugins.SynapMention);
  
});