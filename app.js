const API_KEYS = [
    "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",
    "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",
    "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",
    "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",
    "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"
];

const ROUTER_URL = "https://router.huggingface.co/v1/chat/completions";
const MODELS_API = "https://router.huggingface.co/v1/models";
const GH_MEMORY_RAW_URL = "https://raw.githubusercontent.com/ghost-mvt/XUZ/main/ai/memory.md";

let currentTokenIndex = -1;
let tokenVisible = false;
let userCoreInstructions = "";

let availableModels = []; 
let conversationHistory = []; 

let synth = window.speechSynthesis;
let utterance = new SpeechSynthesisUtterance();
let voices = [];

function loadVoices() { voices = synth.getVoices(); }
loadVoices();
if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;

// --- Token Management ---
function updateTokenDisplay() {
    const tokenEl = document.getElementById("currentTokenValue");
    if (!tokenEl) return; // In case element doesn't exist on current page
    
    const toggleBtn = document.getElementById("toggleTokenBtn");
    const currentToken = API_KEYS[currentTokenIndex];

    if (!currentToken) {
        tokenEl.innerText = "None";
        return;
    }

    if (tokenVisible) {
        tokenEl.innerText = currentToken;
        toggleBtn.innerText = "Hide";
    } else {
        const masked = currentToken.substring(0, 8) + "•••••••••••••••" + currentToken.substring(currentToken.length - 4);
        tokenEl.innerText = masked;
        toggleBtn.innerText = "Show";
    }
}

function toggleTokenVisibility() {
    tokenVisible = !tokenVisible;
    updateTokenDisplay();
}

function getRandomKeyIndex(excludedIndices = []) {
    const availableIndices = API_KEYS.map((_, idx) => idx).filter(idx => !excludedIndices.includes(idx));
    if (availableIndices.length === 0) return -1;
    return availableIndices[Math.floor(Math.random() * availableIndices.length)];
}

// --- Memory Management ---
async function syncMemoryFile() {
    try {
        const res = await fetch(GH_MEMORY_RAW_URL, {
            headers: { "Accept": "application/vnd.github.v3.raw" }
        });
        if (res.ok) {
            userCoreInstructions = await res.text();
            localStorage.setItem("core_instructions", userCoreInstructions);
        } else {
            userCoreInstructions = localStorage.getItem("core_instructions") || "";
        }
    } catch (err) {
        userCoreInstructions = localStorage.getItem("core_instructions") || "";
    }
}

async function updateMemoryFile(newMemoryText) {
    userCoreInstructions = newMemoryText;
    localStorage.setItem("core_instructions", newMemoryText);
}

// --- Models Fetching ---
async function fetchModels(triedIndices = []) {
    const searchInput = document.getElementById("modelSearch");
    const sendBtn = document.getElementById("sendBtn");
    const output = document.getElementById("explanationOutput");

    if (!searchInput) return; // Not on chat page

    const keyIndex = getRandomKeyIndex(triedIndices);

    if (keyIndex === -1) {
        searchInput.placeholder = "Error loading models";
        output.className = "output-box error";
        output.innerText = "Connection Error:\nAll API keys exhausted.";
        return;
    }

    currentTokenIndex = keyIndex;
    updateTokenDisplay();

    try {
        const res = await fetch(MODELS_API, {
            headers: { "Authorization": `Bearer ${API_KEYS[keyIndex]}` }
        });

        if (!res.ok) {
            if (keyIndex + 1 <= API_KEYS.length) {
                return await fetchModels([...triedIndices, keyIndex]);
            }
            throw new Error(`Failed to fetch models. HTTP ${res.status}`);
        }

        const data = await res.json();
        availableModels = [];

        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(model => availableModels.push(model.id));
            searchInput.placeholder = "Type to search models...";
            sendBtn.disabled = false;
            output.innerText = "Models loaded. Token optimizer active.";
        } else {
            searchInput.placeholder = "No models found";
            output.innerText = "No models available.";
        }
    } catch (err) {
        searchInput.placeholder = "Error loading models";
        output.className = "output-box error";
        output.innerText = "Connection Error:\n" + err.message;
    }
}

// --- Chat Logic ---
document.addEventListener("input", (e) => {
    if (e.target.id === "modelSearch") {
        const modelSearch = e.target;
        const modelDropdown = document.getElementById("modelDropdown");
        const selectedModelValue = document.getElementById("selectedModelValue");
        
        const searchTerm = modelSearch.value.toLowerCase();
        selectedModelValue.value = modelSearch.value;
        
        if (searchTerm.trim() === "") {
            modelDropdown.classList.remove("active");
            return;
        }

        const filteredModels = availableModels.filter(model => model.toLowerCase().includes(searchTerm));
        modelDropdown.innerHTML = "";
        
        if (filteredModels.length === 0) {
            modelDropdown.innerHTML = `<div class="dropdown-item">No models match "${searchTerm}"</div>`;
        } else {
            filteredModels.forEach(model => {
                const item = document.createElement("div");
                item.className = "dropdown-item";
                item.innerText = model;
                item.onclick = () => {
                    modelSearch.value = model;
                    selectedModelValue.value = model;
                    modelDropdown.classList.remove("active");
                };
                modelDropdown.appendChild(item);
            });
        }
        modelDropdown.classList.add("active");
    }
});

document.addEventListener("click", (e) => {
    const modelSearch = document.getElementById("modelSearch");
    const modelDropdown = document.getElementById("modelDropdown");
    if (modelSearch && modelDropdown) {
        if (!modelSearch.contains(e.target) && !modelDropdown.contains(e.target)) {
            modelDropdown.classList.remove("active");
        }
    }
});

function calculateMaxTokens() {
    let maxTokens = 1048; 
    if (conversationHistory.length <= 4) {
        maxTokens = 1096;
    }
    return maxTokens;
}

function compressHistoryForTokens(history) {
    if (history.length <= 2) return history;

    const compressed = [];
    compressed.push(history[0]); 
    
    let compressedMidText = "[Historical Context Compressed] -> ";
    for (let i = 1; i < history.length - 2; i++) {
        const msg = history[i];
        if (msg.role === 'assistant') {
            const codeMatch = msg.content.match(/\[CODE_START\]([\s\S]*?)\[CODE_END\]/g);
            if (codeMatch) {
                compressedMidText += `Prev_Code: ${codeMatch.join('; ')} | `;
            } else {
                compressedMidText += `Prev_Resp: ${msg.content.substring(0, 100)}... | `;
            }
        } else {
            compressedMidText += `Prev_Query: ${msg.content.substring(0, 100)}... | `;
        }
    }
    compressed.push({ role: 'system', content: compressedMidText });

    compressed.push(history[history.length - 2]);
    compressed.push(history[history.length - 1]);

    return compressed;
}

async function executeApiFetch(selectedModel, messages, triedIndices = []) {
    const keyIndex = getRandomKeyIndex(triedIndices);

    if (keyIndex === -1) throw new Error("All API keys exhausted.");

    const currentToken = API_KEYS[keyIndex];
    currentTokenIndex = keyIndex;
    updateTokenDisplay();

    try {
        const response = await fetch(ROUTER_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${currentToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: messages,
                temperature: 0.9,
                top_p: 0.9,
                max_tokens: calculateMaxTokens()
            })
        });

        const data = await response.json();

        const isQuotaError = !response.ok && (
            response.status === 402 || 
            response.status === 429 || 
            (data.error && typeof data.error === 'string' && data.error.toLowerCase().includes("quota")) ||
            (data.error?.message && data.error.message.toLowerCase().includes("quota"))
        );

        if (isQuotaError) {
            return await executeApiFetch(selectedModel, messages, [...triedIndices, keyIndex]);
        }

        return { response, data, usedKeyIndex: keyIndex };
    } catch (err) {
        return await executeApiFetch(selectedModel, messages, [...triedIndices, keyIndex]);
    }
}

function extractCode(rawText) {
    const customTagRegex = /\[CODE_START\]([\s\S]*?)\[CODE_END\]/g;
    const customMatches = [...rawText.matchAll(customTagRegex)].map(m => m[1].trim());
    if (customMatches.length > 0) return customMatches.join("\n\n");

    const markdownRegex = /```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g;
    const markdownMatches = [...rawText.matchAll(markdownRegex)].map(m => m[1].trim());
    if (markdownMatches.length > 0) return markdownMatches.join("\n\n");

    return "";
}

async function sendRouterRequest() {
    const selectedModel = document.getElementById("selectedModelValue").value;
    const systemPrompt = document.getElementById("systemPrompt").value;
    const promptText = document.getElementById("promptText").value;
    const explanationOutput = document.getElementById("explanationOutput");
    const rawCodeOutput = document.getElementById("rawCodeOutput");
    const sendBtn = document.getElementById("sendBtn");

    if (!selectedModel.trim()) {
        alert("Please select a model first.");
        return;
    }

    if (!promptText.trim()) {
        alert("Input is empty.");
        return;
    }

    const memoryTrigger = /^(remember:|تذكر:)\s*/i;
    if (memoryTrigger.test(promptText)) {
        const newMemoryData = promptText.replace(memoryTrigger, '').trim();
        const updatedMemory = (userCoreInstructions + "\n" + newMemoryData).trim();
        await updateMemoryFile(updatedMemory);
        explanationOutput.innerText = "Core instructions saved locally. Token context updated.";
        rawCodeOutput.innerText = "No code extracted (Memory Update).";
        document.getElementById("promptText").value = "";
        return;
    }

    sendBtn.disabled = true;
    explanationOutput.className = "output-box";
    explanationOutput.innerHTML = "Processing (Random Token)<span class='loading-dots'></span>";
    rawCodeOutput.innerText = "Awaiting data...";

    conversationHistory.push({ role: "user", content: promptText });

    const baseSystem = systemPrompt;
    const memorySystem = userCoreInstructions ? `\n\n[LAB REFERENCE]\n${userCoreInstructions}` : "";
    const finalSystemPrompt = baseSystem + memorySystem;

    const compressedHistory = compressHistoryForTokens(conversationHistory);

    const messages = [
        { role: "system", content: finalSystemPrompt },
        ...compressedHistory
    ];

    try {
        const { response, data } = await executeApiFetch(selectedModel, messages);

        if (response.ok && data.choices && data.choices[0]?.message?.content) {
            const rawContent = data.choices[0].message.content;
            
            conversationHistory.push({ role: "assistant", content: rawContent });

            const codePart = extractCode(rawContent);
            
            const explanationPart = rawContent
                .replace(/\[CODE_START\][\s\S]*?\[CODE_END\]/g, '[Code extracted below]')
                .replace(/```[\s\S]*?```/g, '[Code extracted below]')
                .trim();

            explanationOutput.innerText = explanationPart || "No explanation provided. See code below.";
            
            if (codePart) {
                rawCodeOutput.innerText = codePart;
            } else {
                rawCodeOutput.innerText = "No explicit code blocks detected.";
            }

        } else {
            explanationOutput.className = "output-box error";
            explanationOutput.innerText = "API Error:\n" + JSON.stringify(data, null, 2);
            rawCodeOutput.innerText = "Error.";
            conversationHistory.pop(); 
        }
    } catch (err) {
        explanationOutput.className = "output-box error";
        explanationOutput.innerText = "System Error:\n" + err.message;
        rawCodeOutput.innerText = "Error.";
        conversationHistory.pop();
    } finally {
        sendBtn.disabled = false;
        document.getElementById("promptText").value = "";
    }
}
