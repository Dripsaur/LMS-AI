(() => {
  function getCurrentUser() {
    return JSON.parse(localStorage.getItem('lms_current_user') || '{}');
  }

  function getUserRole(user) {
    return localStorage.getItem('lms_user_role') || user.role || 'user';
  }

  function getChatSessionId() {
    const user = getCurrentUser();
    const stableUserId = user.student_id || user.userId || user.email;
    const role = getUserRole(user);
    return stableUserId ? `user_${role}_${stableUserId}` : `user_${role}_guest`;
  }

  function getChatUserContext() {
    const user = getCurrentUser();
    return {
      role: (user?.role || 'student').toLowerCase().replace(/\s+/g, ''),
      userId: user.student_id || user.userId || user.email || '',
    };
  }

  function refreshChatbotVisibility() {
    const root = document.getElementById('aiChatbotRoot');
    const { userId } = getChatUserContext();
    if (!root) return;

    root.style.display = userId ? '' : 'none';
    if (!userId) root.querySelector('.chat-panel')?.classList.remove('open');
  }

  window.refreshChatbotVisibility = refreshChatbotVisibility;
  refreshChatbotVisibility();

  function scrollChatToLatest() {
    const chatBody = document.querySelector('.chat-body');
    if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
  }

  function addChatBubble(text, sender = 'ai', muted = false) {
    const chatBody = document.querySelector('.chat-body');
    if (!chatBody) return null;

    const bubble = document.createElement('div');
    bubble.className = `bubble message-${sender}${muted ? ' muted' : ''}`;
    if (sender === 'ai' && !muted) {
      renderMarkdown(bubble, text);
    } else {
      bubble.textContent = text;
    }
    chatBody.appendChild(bubble);
    scrollChatToLatest();
    return bubble;
  }

  // This app is plain HTML/JavaScript, so the React-only react-markdown
  // package cannot be mounted here. Render the common Markdown formats used
  // in chat replies with DOM nodes and textContent (never raw response HTML).
  function renderMarkdown(container, markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    let paragraph = [];
    let list = null;
    let codeBlock = null;

    const appendInline = (element, source) => {
      const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
      let cursor = 0;
      for (const match of source.matchAll(tokenPattern)) {
        if (match.index > cursor) element.append(document.createTextNode(source.slice(cursor, match.index)));
        const token = match[0];
        let node;
        if (token.startsWith('`')) {
          node = document.createElement('code');
          node.textContent = token.slice(1, -1);
        } else if (token.startsWith('**') || token.startsWith('__')) {
          node = document.createElement('strong');
          node.textContent = token.slice(2, -2);
        } else if (token.startsWith('~~')) {
          node = document.createElement('del');
          node.textContent = token.slice(2, -2);
        } else if (token.startsWith('*') || token.startsWith('_')) {
          node = document.createElement('em');
          node.textContent = token.slice(1, -1);
        } else {
          const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
          let url;
          try { url = new URL(link[2], window.location.href); } catch (_error) { url = null; }
          if (url && ['http:', 'https:', 'mailto:'].includes(url.protocol)) {
            node = document.createElement('a');
            node.href = url.href;
            node.target = '_blank';
            node.rel = 'noopener noreferrer';
            node.textContent = link[1];
          } else {
            node = document.createTextNode(token);
          }
        }
        element.append(node);
        cursor = match.index + token.length;
      }
      if (cursor < source.length) element.append(document.createTextNode(source.slice(cursor)));
    };

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement('p');
      paragraph.forEach((line, index) => {
        if (index) p.append(document.createElement('br'));
        appendInline(p, line);
      });
      container.append(p);
      paragraph = [];
    };
    const flushList = () => {
      if (list) container.append(list);
      list = null;
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        flushParagraph();
        flushList();
        if (codeBlock) {
          container.append(codeBlock);
          codeBlock = null;
        } else {
          codeBlock = document.createElement('pre');
          codeBlock.append(document.createElement('code'));
        }
        continue;
      }
      if (codeBlock) {
        codeBlock.firstChild.append(document.createTextNode(`${line}\n`));
        continue;
      }
      const item = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/);
      if (item) {
        flushParagraph();
        const ordered = /^\s*\d/.test(line);
        if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) {
          flushList();
          list = document.createElement(ordered ? 'ol' : 'ul');
        }
        const li = document.createElement('li');
        appendInline(li, item[1]);
        list.append(li);
        continue;
      }
      flushList();
      if (!line.trim()) {
        flushParagraph();
        continue;
      }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        const el = document.createElement(`h${heading[1].length}`);
        appendInline(el, heading[2]);
        container.append(el);
      } else {
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushList();
    if (codeBlock) container.append(codeBlock);
  }

  async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendChatBtn');
    const chatInput = input?.value.trim();
    if (!chatInput || !input || !sendButton) return;

    addChatBubble(chatInput, 'user');
    input.value = '';
    input.disabled = true;
    sendButton.disabled = true;
    const responseBubble = addChatBubble('Thinking…', 'ai', true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatInput,
          sessionId: getChatSessionId(),
          role: getChatUserContext().role,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to get an AI response.');

      responseBubble.replaceChildren();
      renderMarkdown(responseBubble, data.output || 'The chat service did not return a response.');
      responseBubble.classList.remove('muted');
    } catch (error) {
      responseBubble.textContent = error.message || 'Unable to get an AI response.';
    } finally {
      scrollChatToLatest();
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const chatToggle = document.querySelector('.chat-toggle');
    const chatPanel = document.querySelector('.chat-panel');
    const chatClose = document.querySelector('.chat-close');

    chatToggle?.addEventListener('click', () => chatPanel?.classList.toggle('open'));
    chatClose?.addEventListener('click', () => chatPanel?.classList.remove('open'));
    document.getElementById('sendChatBtn')?.addEventListener('click', sendChatMessage);
    document.getElementById('chatInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendChatMessage();
    });
  });
})();
