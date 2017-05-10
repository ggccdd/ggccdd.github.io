/*!
 * search.js
 * @author cl
 */

$(function() {
    // input
    var $search_for = $('#search_for');
    // go search icon
    var $go_search = $('#go_search');
    // post container
    var $post_container = $('#post-container');

    var data_for_search;

    $search_for.focus();
    $search_for.keyup(function(event) {
        if (event.keyCode === 13) {
            $go_search.click();
        }
    });

    // when click the go search icon
    $go_search.click(function() {
        empty($post_container);
        var search_for_string = $search_for.val();
        // don't exist search keyword, so do nothing
        if (!search_for_string) {
            return;
        }
        if (data_for_search === undefined) {
            $.ajax({
                url: '/data/search.json',
                type: 'get',
                dataType: 'json',
                async: false,
                success: function(data) {
                    data_for_search = data;
                },
                error: function() {
                    alert('Something wrong in network!');
                }
            });
        }
        if (data_for_search === undefined) {
            alert('Search failed!');
            return;
        }
        if (data_for_search.length <= 0) {
            return;
        }
        var re = new RegExp(search_for_string, 'i');
        $.each(data_for_search, function(index, entry) {
            if (match(re, entry.title)) {
                $post_container.append(createPostDiv(entry));
            }
        });
    });

    function empty(element) {
        element.empty();
    }

    function match(re, string) {
        return re.test(string);
    }

    function createPostDiv(entry) {
        return '<div class="post-preview">' +
                    '<a href="' + entry.url + '" target="_blank">' +
                        '<h2 class="post-title">' + entry.title +
                        '</h2>' +
                        entry.subtitle_html +
                    '</a>' +
                    '<p class="post-meta">' + entry.data_html + '</p>' +
                '</div>' +
                '<hr>'
    }

});
