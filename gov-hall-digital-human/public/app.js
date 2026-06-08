const GOVERNMENT_SYSTEM_PROMPT = `
你是政务大厅便民咨询数字人，身份是大厅导办员。
服务范围：窗口位置指引、办理流程说明、基础材料清单、取号分流、开放时间说明。
回答要求：
1. 使用普通群众听得懂的中文，短句优先，适合数字人直接播报。
2. 不确定的地方不要编造，以“以当地政务大厅最新公示和窗口审核为准”收束。
3. 不索要身份证号、手机号、银行卡号等敏感个人信息。
4. 涉及社保、医保、市场监管、不动产、税务等业务时，先给办理方向，再给材料和窗口建议。
5. 默认大厅示意：A 区社保，B 区医保，C 区企业开办，D 区综合受理，自助服务区可打印和查询。
6. 每次回答控制在 180 字以内；如果问题不完整，先追问一个关键信息。
`.trim();

const elements = {};
const state = {
  sdk: null,
  connected: false,
  isPortrait: false,
  hasServerDeepSeekKey: false,
  conversation: [],
  abortController: null,
  sequence: 0,
  voiceState: "idle",
  idleWaiter: null,
  resizeTimer: null,
  resizeObserver: null,
  speechActive: false,
  speechSession: createSpeechSession()
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  observeAvatarViewport();
  addMessage("assistant", "您好，我是政务大厅咨询数字人。请问您要办理什么业务？");

  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    state.hasServerDeepSeekKey = Boolean(config.hasServerDeepSeekKey);
    elements.deepseekStatus.textContent = state.hasServerDeepSeekKey
      ? "DeepSeek 服务端已配置"
      : "DeepSeek 前端临时输入";
    if (config.defaultModel) elements.deepseekModel.value = config.defaultModel;
    if (state.hasServerDeepSeekKey) {
      elements.deepseekKey.placeholder = "服务端已配置，可留空";
    }
  } catch {
    elements.deepseekStatus.textContent = "DeepSeek 配置读取失败";
  }
}

function cacheElements() {
  elements.statusLight = document.getElementById("status-light");
  elements.statusText = document.getElementById("status-text");
  elements.deepseekStatus = document.getElementById("deepseek-status");
  elements.xmovAppId = document.getElementById("xmov-app-id");
  elements.xmovAppSecret = document.getElementById("xmov-app-secret");
  elements.deepseekKey = document.getElementById("deepseek-key");
  elements.deepseekModel = document.getElementById("deepseek-model");
  elements.connectBtn = document.getElementById("connect-btn");
  elements.disconnectBtn = document.getElementById("disconnect-btn");
  elements.ratioBtn = document.getElementById("ratio-btn");
  elements.moduleButtons = Array.from(document.querySelectorAll("[data-module]"));
  elements.modulePanels = Array.from(document.querySelectorAll("[data-panel]"));
  elements.interruptBtn = document.getElementById("interrupt-btn");
  elements.clearBtn = document.getElementById("clear-btn");
  elements.chatForm = document.getElementById("chat-form");
  elements.questionInput = document.getElementById("question-input");
  elements.messages = document.getElementById("messages");
  elements.sdkWrapper = document.getElementById("sdk-wrapper");
  elements.sdkContainer = document.getElementById("sdk");
  elements.customSubtitle = document.getElementById("custom-subtitle");
}

function bindEvents() {
  elements.connectBtn.addEventListener("click", connectAvatar);
  elements.disconnectBtn.addEventListener("click", disconnectAvatar);
  elements.ratioBtn.addEventListener("click", toggleRatio);
  elements.interruptBtn.addEventListener("click", stopCurrentWork);
  elements.clearBtn.addEventListener("click", resetConversation);

  elements.moduleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      switchModule(button.getAttribute("data-module") || "chat");
    });
  });

  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuestion(elements.questionInput.value);
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.getAttribute("data-prompt") || "";
      elements.questionInput.value = prompt;
      switchModule("chat");
      submitQuestion(prompt);
    });
  });

  window.addEventListener("beforeunload", () => {
    abortCurrentRequest(false);
    if (state.sdk) state.sdk.destroy();
  });
}

async function connectAvatar() {
  if (state.sdk) return;

  const appId = elements.xmovAppId.value.trim();
  const appSecret = elements.xmovAppSecret.value.trim();
  if (!appId || !appSecret) {
    switchModule("config");
    alert("请先填写魔珐 AppID 和 AppSecret。");
    return;
  }

  if (!window.XmovAvatar) {
    updateStatus("error", "SDK 未加载");
    alert("魔珐 SDK 未加载成功，请检查网络或 CDN 访问。");
    return;
  }

  updateStatus("loading", "连接中...");

  state.sdk = new window.XmovAvatar({
    containerId: "#sdk",
    appId,
    appSecret,
    gatewayServer: "https://nebula-agent.xingyun3d.com/user/v1/ttsa/session",
    onMessage: (message) => console.log("Xmov SDK event:", message),
    onVoiceStateChange: handleVoiceStateChange,
    proxyWidget: {
      subtitle_on: (data) => {
        showSubtitle(data && data.text ? data.text : "");
        return false;
      },
      subtitle_off: () => {
        hideSubtitle();
        return false;
      }
    }
  });

  try {
    await state.sdk.init({
      onDownloadProgress: (progress) => {
        const value = Math.floor(Number(progress) || 0);
        if (value < 100) updateStatus("loading", `${value}%`);
      }
    });

    state.connected = true;
    updateStatus("success", "已连接");
    toggleConnectionButtons(true);
    switchModule("chat");
    requestAvatarResize();
  } catch (error) {
    console.error(error);
    updateStatus("error", "连接失败");
    alert("数字人连接失败，请检查 AppID、AppSecret 或浏览器控制台错误。");
    state.sdk = null;
    state.connected = false;
  }
}

function disconnectAvatar() {
  abortCurrentRequest(true);
  hideSubtitle();

  if (state.sdk) {
    state.sdk.destroy();
    state.sdk = null;
  }

  state.connected = false;
  state.voiceState = "idle";
  state.speechActive = false;
  resetSpeechSession();
  updateStatus("error", "已断开");
  toggleConnectionButtons(false);
}

function toggleConnectionButtons(isConnected) {
  elements.connectBtn.hidden = isConnected;
  elements.disconnectBtn.hidden = !isConnected;
}

function updateStatus(kind, text) {
  elements.statusLight.className = "status-dot";
  if (kind) elements.statusLight.classList.add(kind);
  elements.statusText.textContent = text;
}

function toggleRatio() {
  state.isPortrait = !state.isPortrait;
  elements.sdkContainer.classList.toggle("portrait", state.isPortrait);
  elements.ratioBtn.textContent = state.isPortrait ? "切换横屏" : "切换竖屏";
  requestAvatarResize();
  setTimeout(requestAvatarResize, 160);
  setTimeout(requestAvatarResize, 360);
}

function switchModule(name) {
  elements.moduleButtons.forEach((button) => {
    const isActive = button.getAttribute("data-module") === name;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  elements.modulePanels.forEach((panel) => {
    panel.hidden = panel.getAttribute("data-panel") !== name;
  });

  requestAvatarResize();
}

function observeAvatarViewport() {
  if (!("ResizeObserver" in window)) return;

  state.resizeObserver = new ResizeObserver(() => requestAvatarResize());
  state.resizeObserver.observe(elements.sdkWrapper);
  state.resizeObserver.observe(elements.sdkContainer);
}

function requestAvatarResize() {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("orientationchange"));

    elements.sdkContainer.style.transform = "translateZ(0)";
    requestAnimationFrame(() => {
      elements.sdkContainer.style.transform = "";
    });

    if (!state.sdk) return;

    const methodNames = [
      "resize",
      "refresh",
      "updateSize",
      "resizeCanvas",
      "resizeStage",
      "updateLayout"
    ];

    for (const methodName of methodNames) {
      const method = state.sdk[methodName];
      if (typeof method !== "function") continue;

      try {
        method.call(state.sdk);
      } catch (error) {
        console.debug(`Xmov ${methodName} skipped:`, error);
      }
    }
  }, 40);
}

async function submitQuestion(rawQuestion) {
  const question = String(rawQuestion || "").trim();
  if (!question) return;

  elements.questionInput.value = "";
  setChatBusy(true);
  abortCurrentRequest(false);
  await interruptAvatarAndWait();
  resetSpeechSession();

  const sequence = ++state.sequence;
  addMessage("user", question);
  const assistantMessage = addMessage("assistant", "正在整理答复...");

  state.abortController = new AbortController();
  let answer = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: state.hasServerDeepSeekKey ? "" : elements.deepseekKey.value.trim(),
        model: elements.deepseekModel.value,
        messages: buildMessages(question)
      }),
      signal: state.abortController.signal
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    await readDeepSeekStream(response, (delta) => {
      if (sequence !== state.sequence) return;
      answer += delta;
      updateMessage(assistantMessage, answer || "正在整理答复...");
      pushSpeechDelta(delta);
    });

    if (sequence !== state.sequence) return;

    const finalAnswer = answer.trim() || "暂时没有生成有效答复，请换一种问法。";
    updateMessage(assistantMessage, finalAnswer);
    flushSpeechFinal();

    state.conversation.push(
      { role: "user", content: question },
      { role: "assistant", content: finalAnswer }
    );
    state.conversation = state.conversation.slice(-10);
  } catch (error) {
    if (error.name === "AbortError") {
      updateMessage(assistantMessage, "已停止当前答复。");
      return;
    }

    console.error(error);
    const text = error.message || "请求失败，请检查 DeepSeek Key 或网络。";
    updateMessage(assistantMessage, text);
    addMessage("system", "DeepSeek 调用失败，数字人不会播报本次错误信息。");
  } finally {
    if (sequence === state.sequence) {
      state.abortController = null;
      setChatBusy(false);
    }
  }
}

function buildMessages(question) {
  return [
    { role: "system", content: GOVERNMENT_SYSTEM_PROMPT },
    ...state.conversation.slice(-8),
    { role: "user", content: question }
  ];
}

async function readDeepSeekStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const result = parseSseLine(line);
      if (!result) continue;
      if (result.done) return;
      if (result.delta) onDelta(result.delta);
    }
  }

  if (buffer.trim()) {
    const result = parseSseLine(buffer);
    if (result && result.delta) onDelta(result.delta);
  }
}

function parseSseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
    return null;
  }

  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    const json = JSON.parse(data);
    const delta = json.choices?.[0]?.delta?.content || "";
    return { done: false, delta };
  } catch {
    return null;
  }
}

function pushSpeechDelta(delta) {
  if (!state.sdk || !delta) return;

  state.speechSession.buffer += delta;
  const chunks = drainSpeakableChunks(false);

  for (const chunk of chunks) {
    if (state.speechSession.pending) {
      speakText(state.speechSession.pending, false);
    }
    state.speechSession.pending = chunk;
  }
}

function flushSpeechFinal() {
  if (!state.sdk) {
    resetSpeechSession();
    return;
  }

  const remaining = state.speechSession.buffer.trim();
  state.speechSession.buffer = "";
  const finalText = `${state.speechSession.pending || ""}${remaining}`.trim();
  state.speechSession.pending = "";

  if (finalText) {
    speakText(finalText, true);
  } else {
    resetSpeechSession();
  }
}

function drainSpeakableChunks(final) {
  const chunks = [];
  let buffer = state.speechSession.buffer;

  while (true) {
    const punctuationIndex = buffer.search(/[。！？；\n]/);
    if (punctuationIndex !== -1) {
      const chunk = buffer.slice(0, punctuationIndex + 1).trim();
      buffer = buffer.slice(punctuationIndex + 1);
      if (chunk) chunks.push(chunk);
      continue;
    }

    if (!final && buffer.length > 80) {
      const commaIndex = Math.max(buffer.lastIndexOf("，"), buffer.lastIndexOf(","));
      const splitIndex = commaIndex > 20 ? commaIndex + 1 : 60;
      const chunk = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex);
      if (chunk) chunks.push(chunk);
      continue;
    }

    break;
  }

  state.speechSession.buffer = buffer;
  return chunks;
}

function speakText(text, isEnd) {
  if (!state.sdk || !text) return;

  try {
    const isStart = !state.speechSession.started;
    state.sdk.speak(text, isStart, isEnd);
    state.speechSession.started = true;
    state.speechActive = true;
  } catch (error) {
    console.error(error);
  }
}

async function stopCurrentWork() {
  abortCurrentRequest(true);
  resetSpeechSession();
  await interruptAvatarAndWait();
  hideSubtitle();
  setChatBusy(false);
}

function abortCurrentRequest(invalidate) {
  if (invalidate) state.sequence += 1;
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
}

function interruptAvatarAndWait(timeout = 1200) {
  if (!state.sdk || typeof state.sdk.interactiveidle !== "function") {
    return Promise.resolve();
  }

  const hasActiveVoice =
    state.speechActive || !["idle", "end", "stop"].includes(state.voiceState);
  if (!hasActiveVoice) return Promise.resolve();

  try {
    state.sdk.interactiveidle();
  } catch (error) {
    console.error(error);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      if (state.idleWaiter === finish) state.idleWaiter = null;
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    state.idleWaiter = finish;
  });
}

function handleVoiceStateChange(result) {
  const nextState =
    typeof result === "string"
      ? result
      : result?.state || result?.data?.state || result?.voiceState || "";

  if (!nextState) return;
  state.voiceState = nextState;

  if (nextState === "idle" || nextState === "end" || nextState === "stop") {
    state.speechActive = false;
    if (state.idleWaiter) state.idleWaiter();
  } else {
    state.speechActive = true;
  }
}

function createSpeechSession() {
  return {
    started: false,
    buffer: "",
    pending: ""
  };
}

function resetSpeechSession() {
  state.speechSession = createSpeechSession();
}

function showSubtitle(text) {
  const value = String(text || "").trim();
  if (!value) {
    hideSubtitle();
    return;
  }
  elements.customSubtitle.textContent = value;
  elements.customSubtitle.style.display = "block";
}

function hideSubtitle() {
  elements.customSubtitle.textContent = "";
  elements.customSubtitle.style.display = "none";
}

function addMessage(role, text) {
  const item = document.createElement("div");
  item.className = `message ${role}`;

  const label = document.createElement("div");
  label.className = "message-role";
  label.textContent = roleLabel(role);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;

  item.append(label, body);
  elements.messages.appendChild(item);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return item;
}

function updateMessage(messageElement, text) {
  const body = messageElement.querySelector(".message-body");
  if (body) body.textContent = text;
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function roleLabel(role) {
  if (role === "user") return "群众";
  if (role === "assistant") return "数字人";
  return "系统";
}

function resetConversation() {
  abortCurrentRequest(true);
  state.conversation = [];
  elements.messages.innerHTML = "";
  addMessage("assistant", "您好，我是政务大厅咨询数字人。请问您要办理什么业务？");
}

function setChatBusy(isBusy) {
  elements.chatForm.querySelector("button").disabled = isBusy;
  elements.questionInput.disabled = isBusy;
}

async function readError(response) {
  try {
    const payload = await response.json();
    const detail = payload.detail ? ` ${payload.detail}` : "";
    return `${payload.error || "请求失败。"}${detail}`;
  } catch {
    return "请求失败，请检查服务端日志。";
  }
}
