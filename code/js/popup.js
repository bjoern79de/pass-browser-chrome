'use strict';

(function() {
  var $ = require('./libs/jquery');
  var progressJs = require('./libs/progress').progressJs;

  var msg = require('./modules/msg').init('popup');

  function fuzzyContains(hay, needle) {
    hay = hay.toLowerCase();

    var i = 0, n = -1, l;
    needle = needle.toLowerCase();
    for (; l = needle[i++] ;) {
      if (!~(n = hay.indexOf(l, n + 1))) {
        return false;
      }
    }
    return true;
  }

  function filterSecrets(query) {
    // filter list
    $('.secret').each(function(i, secretElem) {
      if (fuzzyContains($(secretElem).attr('data-domain'), query) ||
          fuzzyContains($(secretElem).attr('data-username-normalized'), query)) {
        $(secretElem).show();
      } else {
        $(secretElem).hide();
      }
    });
  }

  function fillTopSecrets(done) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      var parseDomain = require('parse-domain');
      var parts = parseDomain(tabs[0].url);
      if (parts === null) {
        // invalid domain (extension pages, settings etc.)
        done();
        return;
      }
      var currentSubdomain = [parts.subdomain, parts.domain, parts.tld].join('.');
      var currentDomain = [parts.domain, parts.tld].join('.');

      // find matches
      var subdomainMatches = [];
      var domainMatches = [];
      $('#all-secrets .secret').each(function(i, secretElem) {
        var secretDomain = $(secretElem).attr('data-domain');

        // move matches to #top-list
        if (secretDomain.indexOf(currentSubdomain) === 0) {
          subdomainMatches.push($(secretElem).clone());
          $(secretElem).remove();
        }
        if (secretDomain.indexOf(currentDomain) === 0) {
          domainMatches.push($(secretElem).clone());
          $(secretElem).remove();
        }
      });

      // add matches in order to #top-secrets
      if (subdomainMatches.length + domainMatches.length) {
        $('#top-secrets').show();
        $.each(subdomainMatches, function(i, secretElem) {
          $(secretElem).appendTo($('#top-secrets'));
        });
        $.each(domainMatches, function(i, secretElem) {
          $(secretElem).appendTo($('#top-secrets'));
        });
      }

      done();
    });
  }

  $(function() {
    $('#go-to-options').on('click', function() {
      chrome.runtime.openOptionsPage();
    });

    function clearAlerts() {
      $('.alerts').empty();
    }

    function hideUnlock() {
      $('#unlock-form').off('submit');
      $('#unlock-form').hide();
      $('#unlock').removeClass('active');
    }

    function showSecrets() {
      msg.bg('setUnlockIcon');

      hideUnlock();

      $('#secrets').show();
    }

    function hideSecrets() {
      $('#secrets').hide();
      $('#secrets').empty();
    }

    function showUnlock() {
      msg.bg('setLockIcon');

      hideSecrets();

      $('#unlock-form').on('submit', function resetUnlockButton() {
        // reset unlock button's styling
        $('#unlock')
          .removeClass('btn-success btn-warning btn-danger')
          .addClass('btn-primary');
      });
      $('#unlock-form').on('submit', function checkPassphrase(event) {
        var passphrase = $('#passphrase').val();

        // unlock in background.js
        msg.bg('testPassphrase', passphrase, function(unlocked) {
          if (unlocked === null) {
            // create alert
            var alertElem = $('<div role="alert">').addClass('alert alert-danger')
              .text('You must generate and save a key first. Go to options to do so.');

            // clear any existing alerts
            clearAlerts();

            // show new alert
            $(alertElem).appendTo($('.alerts'));
          } else if (unlocked) {
            // start progress while retrieving secrets from server
            var progress = progressJs('#unlock')
              .setOptions({
                theme: 'blueOverlayRadiusHalfOpacity',
                overlayMode: true
              });
            progress.start();
            progress.autoIncrease(100);

            msg.bg('getSecrets', function(data) {
              if (data.error) {
                progress.end();
                $('#unlock')
                  .removeClass('btn-primary btn-danger btn-success')
                  .addClass('btn-warning');

                if (data.error < 500) {
                  $('#unlock span').text(data.response.error);
                } else {
                  msg.bg('notify', 'pass-private-server-server-error', {
                    type: 'basic',
                    title: 'Server Error',
                    message: data.response.error,
                    iconUrl: chrome.runtime.getURL('images/icon-locked-128.png'),
                    priority: 1
                  });
                }
              } else {
                // succcess
                $('#unlock')
                  .removeClass('btn-primary btn-warning btn-danger')
                  .addClass('btn-success');
                $('#unlock span').text('Unlocked');
                progress.end();
                setTimeout(function() {
                  // hide unlock form and switch to secrets
                  showSecrets();

                  // loop through secrets and show progress if any
                  if (data.secrets.length) {
                    var secretsList = $($('#secrets-list-template').clone().get(0).content).children();
                    var secretTemplate = $($('#secrets-list-item-template').clone().get(0).content).children();

                    // show search + list
                    secretsList.appendTo($('#secrets'));

                    // bind copy/show events
                    $('.container').on('click', '.username-copy', function(event) {
                      var username = $(event.target).closest('.secret').find('.username');
                      msg.bg('copyUsername', username.val(), function() {
                        $('.copied').each(function(i, elem) {
                          $(elem).text($(elem).data('reset-text'));
                          $(elem).removeClass('copied label-primary');
                        });
                        if (!$(event.target).data('reset-text')) {
                          $(event.target).data('reset-text', $(event.target).text());
                        }
                        $(event.target).text($(event.target).data('copied-text'));
                        $(event.target).addClass('copied label-primary');
                      });
                    });
                    $('.container').on('click', '.password-copy', function(event) {
                      var secret = $(event.target).closest('.secret');
                      var path = secret.data('path');
                      var username = secret.data('username');
                      msg.bg('copyPassword', path, username, function(result) {
                        if (result.error) {
                          $(event.target).removeClass('copied label-primary');
                          $(event.target).addClass('label-danger');
                        } else {
                          $('.copied').each(function(i, elem) {
                            $(elem).text($(elem).data('reset-text'));
                            $(elem).removeClass('copied label-primary');
                          });
                          if (!$(event.target).data('reset-text')) {
                            $(event.target).data('reset-text', $(event.target).text());
                          }
                          $(event.target).text($(event.target).data('copied-text'));
                          $(event.target).removeClass('label-danger');
                          $(event.target).addClass('copied label-primary');
                        }
                      });
                    });
                    $('.container').on('click', '.password-show', function(event) {
                      var hiddenPasswordText = secretTemplate.find('input.password').val();
                      var secret = $(event.target).closest('.secret');
                      var path = secret.data('path');
                      var username = secret.data('username');
                      msg.bg('showPassword', path, username, function(result) {
                        if (result.error) {
                          $(secret).find('.password').val(hiddenPasswordText);
                          $(event.target).removeClass('label-success');
                          $(event.target).addClass('label-danger');
                        } else {
                          $(secret).find('.password').val(result.password);
                          $(event.target).removeClass('label-danger');
                          $(event.target).addClass('label-success');
                        }
                      });
                    });

                    // add secrets to #all-secrets
                    $.each(data.secrets, function(i, secret) {
                      var template = secretTemplate.clone();

                      // add secret to list
                      template.find('.domain').text(secret.domain);
                      template.find('.username').val(secret.username).attr('title', secret.username);
                      template
                        .attr('data-domain', secret.domain)
                        .attr('data-path', secret.path)
                        .attr('data-username-normalized', secret.username_normalized)
                        .attr('data-username', secret.username)
                        // do not display initially
                        .css('display', 'none');  // .hide() won't work yet
                      template.appendTo($('#all-secrets'));
                    });

                    var animationDelay = 25;

                    // start progress while building list
                    var progressIncrement = Math.ceil(100 / data.secrets.length);
                    progress = progressJs('#all-secrets');
                    progress.start().autoIncrease(progressIncrement, animationDelay);

                    // place domain matches on top, with subdomain
                    // matches first
                    fillTopSecrets(function() {
                      // make secrets visible
                      $.each($('.secret'), function(i, secretElem) {
                        setTimeout(function() {
                          // show element
                          $(secretElem).show();

                          if ((i + 1) === data.secrets.length) {
                            // end progress
                            progress.end();

                            // filter list on render finish
                            var currentQuery = $('#search').val().trim();
                            if (!currentQuery) {
                              chrome.storage.local.get('lastQuery', function(items) {
                                var lastQuery = items.lastQuery;
                                if (lastQuery) {
                                  $('#search').val(lastQuery);
                                  $('#search').focus();
                                  $('#search').select();
                                  filterSecrets(lastQuery);
                                } else {
                                  $('#search').focus();
                                }
                              });
                            } else {
                              filterSecrets(currentQuery);
                              $('#search').focus();
                            }
                          }
                        }, i * animationDelay);
                      });
                    });
                  } else {
                    // no secrets retrieved from server
                    if (data.error) {
                      console.log(data.error);
                    } else {
                      var noSecretsMessage = $($('#no-secrets-template').clone().get(0).content).children();
                      noSecretsMessage.appendTo($('#secrets'));
                    }
                  }
                }, 200);
              }
            });
          } else {
            // error
            $('#unlock')
              .removeClass('btn-primary btn-success')
              .addClass('btn-danger');
          }
        });
        event.preventDefault();
      });
    }

    $('.container').on('input', '#search', function(event) {
      var query = $(event.target).val().trim();
      chrome.storage.local.set({lastQuery: query}, function() {
        if (query) {
          filterSecrets(query);
        } else {
          $('.secret').show();
        }
      });
    });

    // always show unlock form
    showUnlock();
  });
})();
