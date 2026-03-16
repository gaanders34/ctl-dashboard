/**
 * Agent tab: OTD & Throughput advisor. Uses Manager context (focus list, past due by route, summary)
 * and optionally calls OpenAI to get prioritized recommendations.
 */
(function () {
  'use strict';

  var SYSTEM_PROMPT = 'You are the CTL Manager for a steel distribution / cut-to-length production facility. The data below is the same view the CTL Manager tab uses: summary (past due, next 72h, ready to ship, blocked jobs, MTD coils), past due by route, and the prioritized focus list for the next 3 days.\n\nYour job is to act as the CTL Manager: drive OTD and throughput by telling the team what to do first and why.\n\nOutput in this order:\n1. **Top 3 priorities right now** — What must get attention today (reference specific routes, order volumes, or material issues from the context).\n2. **Next 48 hours** — What to do in the next 2 days: schedule changes, material follow-ups, or capacity adjustments. Be specific (e.g. route names, “fast wins” vs “blocked” where the context mentions them).\n3. **Numbered action list (5–10 items)** — Clear, actionable steps. Match the severity and categories in the focus list (Material, OTD, Performance, etc.). Say which orders/routes to prioritize, what to expedite, and what could go wrong if ignored.\n\nWrite like a manager briefing: concise, prioritised, and specific to the numbers and routes in the context.';

  var SIOP_SYSTEM_PROMPT = 'You are a SIOP (Sales, Inventory & Operations Planning) planner for a steel distribution / production facility. Given the following production and order context, build a **1-week SIOP plan** (next 5–7 days).\n\nOutput the following in clear sections:\n\n1. **Demand vs Supply table** — Use a markdown table with columns: Period (e.g. Day 1, Day 2, … or Mon–Fri), Demand (lbs or coils — from orders due / backlog in the context), Supply (planned or available — from schedule/capacity in the context), Gap (Demand − Supply), Notes. Infer numbers from the context where possible; use reasonable estimates if exact figures are missing.\n\n2. **Cumulative gap** — One line: whether the week builds backlog (negative cumulative gap) or surplus (positive), and by how much.\n\n3. **Recommended actions for the week** — 3–5 specific actions (e.g. which orders to prioritize, material to expedite, capacity adjustments) to balance demand and supply. Reference routes, customers, or order IDs from the context when relevant.\n\nUse the data below as the source for demand (past due, due next 72h, open orders) and supply (schedule, MTD coils, capacity, blocked jobs).';

  function getContext() {
    if (typeof window.ctlManagerGetAgentContext === 'function') {
      return window.ctlManagerGetAgentContext();
    }
    return 'Load Open Status, Production Schedule, and Material Availability in their tabs, then refresh the Manager or Agent context to see data here.';
  }

  var SIOP_PLAN_STORAGE_KEY = 'ctl-agent-siop-plan';
  var lastRecommendationsText = '';
  var followUpConversation = [];

  function setStatus(msg, isError) {
    var el = document.getElementById('agent-status');
    if (el) {
      el.textContent = msg || '';
      el.className = 'paste-status' + (isError ? ' paste-status-warn' : '');
    }
  }

  function setSiopStatus(msg, isError) {
    var el = document.getElementById('agent-siop-status');
    if (el) {
      el.textContent = msg || '';
      el.className = 'paste-status' + (isError ? ' paste-status-warn' : '');
    }
  }

  function setFollowUpStatus(msg, isError) {
    var el = document.getElementById('agent-follow-up-status');
    if (el) {
      el.textContent = msg || '';
      el.className = 'paste-status' + (isError ? ' paste-status-warn' : '');
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function appendFollowUpQA(question, answer) {
    var wrap = document.getElementById('agent-follow-up-answers');
    if (!wrap) return;
    var block = document.createElement('div');
    block.className = 'agent-follow-up-block';
    block.innerHTML =
      '<div class="agent-follow-up-q"><strong>You asked:</strong> ' + escapeHtml(question) + '</div>' +
      '<div class="agent-follow-up-a"><strong>Agent:</strong><div class="agent-follow-up-a-body">' +
      answer.split('\n').map(function (line) { return escapeHtml(line) + '<br/>'; }).join('') +
      '</div></div>';
    wrap.appendChild(block);
    block.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function init() {
    var contextTa = document.getElementById('agent-context');
    var refreshBtn = document.getElementById('agent-refresh-context');
    var copyBtn = document.getElementById('agent-copy-context');
    var getRecBtn = document.getElementById('agent-get-recommendations');
    var apiKeyInput = document.getElementById('agent-api-key');
    var responseWrap = document.getElementById('agent-response-wrap');
    var responseBody = document.getElementById('agent-response');

    if (refreshBtn && contextTa) {
      refreshBtn.addEventListener('click', function () {
        contextTa.value = getContext();
      });
    }

    if (copyBtn && contextTa) {
      copyBtn.addEventListener('click', function () {
        if (!contextTa.value) contextTa.value = getContext();
        contextTa.select();
        try {
          document.execCommand('copy');
          setStatus('Copied to clipboard.', false);
        } catch (e) {
          try {
            navigator.clipboard.writeText(contextTa.value);
            setStatus('Copied to clipboard.', false);
          } catch (e2) {
            setStatus('Copy failed. Select and copy manually.', true);
          }
        }
      });
    }

    if (getRecBtn && apiKeyInput && responseWrap && responseBody) {
      getRecBtn.addEventListener('click', function () {
        var key = (apiKeyInput && apiKeyInput.value || '').trim();
        if (!key) {
          setStatus('Enter an OpenAI API key to get recommendations.', true);
          return;
        }
        var context = getContext();
        setStatus('Getting recommendations…', false);
        getRecBtn.disabled = true;

        var payload = {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: context }
          ],
          max_tokens: 1500
        };

        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (err) { throw new Error(err.error && err.error.message ? err.error.message : res.status + ' ' + res.statusText); });
            return res.json();
          })
          .then(function (data) {
            var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : 'No response.';
            lastRecommendationsText = text;
            followUpConversation = [];
            responseBody.textContent = '';
            responseBody.innerHTML = text.split('\n').map(function (line) {
              return escapeHtml(line) + '<br/>';
            }).join('');
            responseWrap.hidden = false;
            setStatus('Done.', false);
            var followUpSection = document.getElementById('agent-follow-up-section');
            var followUpAnswers = document.getElementById('agent-follow-up-answers');
            if (followUpSection) followUpSection.hidden = false;
            if (followUpAnswers) followUpAnswers.innerHTML = '';
          })
          .catch(function (err) {
            setStatus(err.message || 'Request failed.', true);
            responseWrap.hidden = true;
          })
          .then(function () {
            getRecBtn.disabled = false;
          });
      });
    }

    var askFollowUpBtn = document.getElementById('agent-ask-follow-up');
    var followUpQuestionTa = document.getElementById('agent-follow-up-question');
    if (askFollowUpBtn && followUpQuestionTa) {
      askFollowUpBtn.addEventListener('click', function () {
        var key = (apiKeyInput && apiKeyInput.value || '').trim();
        if (!key) {
          setFollowUpStatus('Enter an OpenAI API key above.', true);
          return;
        }
        if (!lastRecommendationsText) {
          setFollowUpStatus('Get recommendations first, then ask a follow-up.', true);
          return;
        }
        var question = (followUpQuestionTa.value || '').trim();
        if (!question) {
          setFollowUpStatus('Type a question first.', true);
          return;
        }
        setFollowUpStatus('Getting answer…', false);
        askFollowUpBtn.disabled = true;

        var context = getContext();
        var messages = [
          { role: 'system', content: SYSTEM_PROMPT + ' The user has already received your CTL Manager recommendations above. They are now asking a follow-up. Answer as the CTL Manager would: practical, prioritised, and specific to our operations. Explain how to do something, clarify a recommendation, or give step-by-step guidance. Reference routes, orders, or material from the context when relevant.' },
          { role: 'user', content: context },
          { role: 'assistant', content: lastRecommendationsText }
        ];
        followUpConversation.forEach(function (m) { messages.push(m); });
        messages.push({ role: 'user', content: question });

        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: messages,
            max_tokens: 1500
          })
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (err) { throw new Error(err.error && err.error.message ? err.error.message : res.status + ' ' + res.statusText); });
            return res.json();
          })
          .then(function (data) {
            var answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : 'No response.';
            followUpConversation.push({ role: 'user', content: question });
            followUpConversation.push({ role: 'assistant', content: answer });
            appendFollowUpQA(question, answer);
            followUpQuestionTa.value = '';
            setFollowUpStatus('Done. You can ask another follow-up.', false);
          })
          .catch(function (err) {
            setFollowUpStatus(err.message || 'Request failed.', true);
          })
          .then(function () {
            askFollowUpBtn.disabled = false;
          });
      });
    }

    var buildSiopBtn = document.getElementById('agent-build-siop');
    var copySiopToTabBtn = document.getElementById('agent-copy-siop-to-tab');
    var siopResponseWrap = document.getElementById('agent-siop-response-wrap');
    var siopResponseBody = document.getElementById('agent-siop-response');
    var apiKeyInput = document.getElementById('agent-api-key');

    if (buildSiopBtn && siopResponseWrap && siopResponseBody) {
      buildSiopBtn.addEventListener('click', function () {
        var key = (apiKeyInput && apiKeyInput.value || '').trim();
        if (!key) {
          setSiopStatus('Enter an OpenAI API key above to build the SIOP plan.', true);
          return;
        }
        var context = getContext();
        setSiopStatus('Building 1-week SIOP plan…', false);
        buildSiopBtn.disabled = true;
        siopResponseWrap.hidden = true;

        var payload = {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SIOP_SYSTEM_PROMPT },
            { role: 'user', content: context }
          ],
          max_tokens: 2000
        };

        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (err) { throw new Error(err.error && err.error.message ? err.error.message : res.status + ' ' + res.statusText); });
            return res.json();
          })
          .then(function (data) {
            var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ? data.choices[0].message.content : 'No response.';
            siopResponseBody.textContent = '';
            siopResponseBody.innerHTML = text.split('\n').map(function (line) {
              return escapeHtml(line) + '<br/>';
            }).join('');
            siopResponseWrap.hidden = false;
            setSiopStatus('Done. You can copy the plan or send it to the SIOP tab.', false);
            try {
              localStorage.setItem(SIOP_PLAN_STORAGE_KEY, text);
            } catch (e) {}
            if (copySiopToTabBtn) copySiopToTabBtn.style.display = '';
          })
          .catch(function (err) {
            setSiopStatus(err.message || 'Request failed.', true);
            siopResponseWrap.hidden = true;
          })
          .then(function () {
            buildSiopBtn.disabled = false;
          });
      });
    }

    if (copySiopToTabBtn) {
      copySiopToTabBtn.addEventListener('click', function () {
        try {
          var plan = localStorage.getItem(SIOP_PLAN_STORAGE_KEY);
          if (plan && typeof window.ctlSwitchTab === 'function') {
            window.ctlSwitchTab('siop');
            setSiopStatus('Switched to SIOP tab. Plan is in "Plan from Agent" below.', false);
          } else if (!plan) {
            setSiopStatus('Build a SIOP plan first.', true);
          }
        } catch (e) {
          setSiopStatus('Could not switch to SIOP tab.', true);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
