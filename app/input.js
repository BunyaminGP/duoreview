// Saf arayüz girdi ve yaşam döngüsü işleyicisi. Hem Electron renderer (<script>)
// hem de Node.js birim testleri (test/input.test.mjs) tarafından kullanılır.
(function (root) {
  const RESET_TUI_MODES_SEQ = "\x1b[?1049l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[0m";

  function resetTerminalModes(term) {
    if (term && typeof term.write === "function") {
      term.write(RESET_TUI_MODES_SEQ);
    }
  }

  function isCtrlOrCmd(e) {
    return Boolean(e && (e.ctrlKey || e.metaKey));
  }

  function handleTerminalKey(e, ctx = {}) {
    if (!e) return { handled: false };
    const key = String(e.key || "");
    const hasSelection = Boolean(ctx.hasSelection);
    const clipboardText = typeof ctx.clipboardText === "string" ? ctx.clipboardText : "";
    const selectedText = typeof ctx.selectedText === "string" ? ctx.selectedText : "";

    // Ctrl+C / Cmd+C: seçim varsa kopyala, seçim yoksa terminale bırak (SIGINT)
    if (isCtrlOrCmd(e) && (key === "c" || key === "C") && !e.shiftKey && !e.altKey) {
      if (hasSelection) {
        return { handled: true, action: "copy", text: selectedText };
      }
      return { handled: false };
    }

    // Ctrl+V, Ctrl+Shift+V, Shift+Insert yapıştırma
    const isPasteKey =
      (isCtrlOrCmd(e) && (key === "v" || key === "V")) ||
      (e.shiftKey && (key === "Insert" || key === "paste"));

    if (isPasteKey && !e.altKey) {
      if (clipboardText.length > 0) {
        return { handled: true, action: "paste", text: clipboardText };
      }
      // Pano boşsa görsel yapıştırma gibi kısayollar için \x16 terminale geçirilir
      return { handled: true, action: "image-passthrough", code: "\x16" };
    }

    return { handled: false };
  }

  function createPasteTargetManager({ readClipboard, pasteToAgent }) {
    let pendingCount = 0;
    return {
      getPendingCount: () => pendingCount,
      async triggerPaste(targetAgent) {
        if (!targetAgent) return false;
        const lockedAgent = targetAgent;
        pendingCount++;
        try {
          const text = await readClipboard();
          if (typeof text === "string" && text.length > 0) {
            await pasteToAgent(lockedAgent, text);
            return true;
          }
          return false;
        } finally {
          pendingCount--;
        }
      },
    };
  }

  function createComposerController({ agent, sendFn, onStateChange }) {
    let draft = "";
    let sending = false;
    let error = null;

    function notify() {
      if (typeof onStateChange === "function") {
        onStateChange({ agent, draft, sending, error });
      }
    }

    return {
      getAgent: () => agent,
      getDraft: () => draft,
      setDraft(text) {
        draft = String(text ?? "");
        error = null;
        notify();
      },
      isSending: () => sending,
      getError: () => error,
      async send() {
        if (sending) {
          return { sent: false, reason: "busy", draft };
        }
        const textToSend = draft;
        if (!textToSend.trim()) {
          return { sent: false, reason: "empty", draft };
        }

        sending = true;
        error = null;
        notify();

        try {
          const res = await sendFn(agent, textToSend);
          if (res && res.ok) {
            if (draft === textToSend) {
              draft = "";
            } else if (draft.startsWith(textToSend)) {
              draft = draft.slice(textToSend.length);
            }
            sending = false;
            notify();
            return { sent: true, res, draft };
          } else {
            error = (res && res.error) ? String(res.error) : "Send failed";
            sending = false;
            notify();
            return { sent: false, error, draft };
          }
        } catch (err) {
          error = err && err.message ? err.message : String(err);
          sending = false;
          notify();
          return { sent: false, error, draft };
        }
      },
    };
  }

  function createHoldController({ setHoldFn }) {
    const states = {};

    function update(agent, held, force = false) {
      const boolHeld = Boolean(held);
      if (force || states[agent] !== boolHeld) {
        states[agent] = boolHeld;
        if (typeof setHoldFn === "function") {
          setHoldFn(agent, boolHeld);
        }
      }
    }

    return {
      isHeld: (agent) => Boolean(states[agent]),
      onFocus(agent, text) {
        const hasContent = Boolean(text && text.trim().length > 0);
        update(agent, hasContent);
      },
      onInput(agent, text, isFocused = true) {
        const hasContent = Boolean(text && text.trim().length > 0);
        const shouldHold = Boolean(isFocused && hasContent);
        // Taslak doluysa her girişte hold(true) yenilenir (zaman aşımı sıfırlanır)
        update(agent, shouldHold, shouldHold);
      },
      onBlur(agent) {
        update(agent, false);
      },
    };
  }

  function getLifecycleButtonState(lifeState) {
    const state = String(lifeState || "STOPPED").toUpperCase();
    switch (state) {
      case "RUNNING":
        return { state, canStart: false, canStop: true, canSend: true, restartable: false };
      case "STOPPING":
        return { state, canStart: false, canStop: false, canSend: false, restartable: false };
      case "STOPPED":
        return { state, canStart: true, canStop: false, canSend: false, restartable: true };
      case "EXITED":
        return { state, canStart: true, canStop: false, canSend: false, restartable: true };
      case "FAILED":
        return { state, canStart: true, canStop: false, canSend: false, restartable: true };
      default:
        return { state: "STOPPED", canStart: true, canStop: false, canSend: false, restartable: true };
    }
  }

  function formatLifecycleStatus(lifeState, lifeWhy, t) {
    const translate = typeof t === "function" ? t : (k) => k;
    const state = String(lifeState || "STOPPED").toUpperCase();
    const stateKey = "st_" + state;
    const baseText = translate(stateKey) !== stateKey ? translate(stateKey) : state;
    if (lifeWhy && String(lifeWhy).trim()) {
      return `${baseText} · ${lifeWhy}`;
    }
    return baseText;
  }

  const api = {
    RESET_TUI_MODES_SEQ,
    resetTerminalModes,
    handleTerminalKey,
    createPasteTargetManager,
    createComposerController,
    createHoldController,
    getLifecycleButtonState,
    formatLifecycleStatus,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.InputLib = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
