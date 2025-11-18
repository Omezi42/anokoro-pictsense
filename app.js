// Firebase モジュールのインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    updateDoc, 
    onSnapshot, 
    Timestamp, 
    arrayUnion,
    writeBatch,
    increment 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAbb-B4IaknBvhJDs1Nw2RymsLSqTQSyn8",
  authDomain: "anokoro-pictsense.firebaseapp.com",
  projectId: "anokoro-pictsense",
  storageBucket: "anokoro-pictsense.firebasestorage.app",
  messagingSenderId: "769791445375",
  appId: "1:769791445375:web:76047b7ec3871dbe27f24a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentRoomId = null;
let roomUnsubscribe = null;
let roomData = null;
let dictionary = [];
let dictionaryFetched = false;
let isDrawer = false;
let flowingCommentIds = new Set(); 
let heartbeatInterval = null; // ★追加: 生存監視用タイマー

let canvas, ctx;
let isDrawing = false;
let lastX = 0, lastY = 0;
let currentColor = '#000000';
let currentLineWidth = 5;
let strokeBuffer = [];
let bufferTimer = null;

const loadingModal = document.getElementById('loading-modal');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const roomIdDisplay = document.getElementById('room-id-display');
const leaveRoomBtn = document.getElementById('leave-room-btn');
const gameStartBtn = document.getElementById('game-start-btn');
const statusBar = document.getElementById('status-bar');
const currentWordDisplay = document.getElementById('current-word-display');
const canvasContainer = document.getElementById('canvas-container');
const commentFlowContainer = document.getElementById('comment-flow-container');
const drawingToolbar = document.getElementById('drawing-toolbar');
const colorPicker = document.getElementById('color-picker');
const quickColorPalette = document.getElementById('quick-color-palette');
const eraserBtn = document.getElementById('eraser-btn');
const lineWidthSlider = document.getElementById('line-width-slider');
const lineWidthDisplay = document.getElementById('line-width-display');
const clearCanvasBtn = document.getElementById('clear-canvas-btn');
const passBtn = document.getElementById('pass-btn');
const checkWordBtn = document.getElementById('check-word-btn'); 
const dictionarySearchContainer = document.getElementById('dictionary-search-container');
const dictionarySearchInput = document.getElementById('dictionary-search-input');
const dictionarySearchResults = document.getElementById('dictionary-search-results');
const scoreboardContainer = document.getElementById('scoreboard-container');
const messagesContainer = document.getElementById('messages-container');
const answerForm = document.getElementById('answer-form');
const answerInput = document.getElementById('answer-input');

const resultModal = document.getElementById('result-modal');
const resultTitle = document.getElementById('result-title');
const resultWinner = document.getElementById('result-winner');
const resultWord = document.getElementById('result-word');
const resultPoints = document.getElementById('result-points');
const resultImageContainer = document.getElementById('result-image-container');
const resultImage = document.getElementById('result-image');
const showImageModal = document.getElementById('show-image-modal');
const showImageWord = document.getElementById('show-image-word');
const showImageImg = document.getElementById('show-image-img');
const showImageCloseBtn = document.getElementById('show-image-close-btn');

const rulesCheckboxes = {
    dictionarySearch: document.getElementById('rule-dictionary-search'),
    showImageBefore: document.getElementById('rule-show-image-before'),
    showImageAfter: document.getElementById('rule-show-image-after'),
    flowingComments: document.getElementById('rule-flowing-comments'),
    wordHint: document.getElementById('rule-word-hint'),
};

window.onload = () => {
    signInAnonymously(auth).catch((error) => {
        console.error("匿名認証に失敗しました:", error);
        alert("認証に失敗しました。ページをリロードしてください。");
    });

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("匿名認証成功:", user.uid);
            loadingModal.classList.add('hidden');
        } else {
            console.log("ユーザーがサインアウトしました。");
            loadingModal.classList.add('hidden');
        }
    });

    setupCanvas();
    setupEventListeners();
    fetchDictionary(); 
};

function setupCanvas() {
    canvas = document.getElementById('drawing-canvas');
    if (!canvas) {
        console.error("キャンバス要素が見つかりません。");
        return;
    }
    ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
}

function setupEventListeners() {
    joinForm.addEventListener('submit', handleJoinRoom);
    leaveRoomBtn.addEventListener('click', handleLeaveRoom);
    gameStartBtn.addEventListener('click', handleGameStart);
    answerForm.addEventListener('submit', handleAnswerSubmit);

    colorPicker.addEventListener('input', (e) => setCurrentColor(e.target.value));
    quickColorPalette.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.color) {
            setCurrentColor(e.target.dataset.color);
        }
    });
    eraserBtn.addEventListener('click', () => setCurrentColor('#FFFFFF'));
    lineWidthSlider.addEventListener('input', (e) => {
        currentLineWidth = e.target.value;
        lineWidthDisplay.textContent = currentLineWidth;
    });
    clearCanvasBtn.addEventListener('click', handleClearCanvas);
    passBtn.addEventListener('click', handlePass);
    checkWordBtn.addEventListener('click', handleCheckWord); 

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startDrawing(e.touches[0]);
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e.touches[0]);
    }, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);

    dictionarySearchInput.addEventListener('input', handleDictionarySearch);
    dictionarySearchResults.addEventListener('click', (e) => {
        if (e.target.tagName === 'DIV' && e.target.dataset.word) {
            answerInput.value = e.target.dataset.word;
            dictionarySearchResults.innerHTML = '';
            dictionarySearchInput.value = '';
        }
    });

    showImageCloseBtn.addEventListener('click', () => {
        showImageModal.classList.add('hidden');
    });

    // ★追加: タブを閉じる/更新した際のイベント
    window.addEventListener('beforeunload', (e) => {
        // 退室処理を試みる（非同期のため確実ではないが、多くのケースで機能する）
        handleLeaveRoom(true);
        // 一部のブラウザで確認ダイアログを出す場合（今回は出さない）
        // e.preventDefault();
        // e.returnValue = ''; 
    });
}

async function handleJoinRoom(e) {
    e.preventDefault();
    if (!currentUser) {
        alert("認証情報がありません。ページをリロードしてください。");
        return;
    }

    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    if (!username || !roomId) {
        alert("ユーザー名とルームIDを入力してください。");
        return;
    }

    currentRoomId = roomId;
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    
    loadingModal.classList.remove('hidden');

    try {
        const roomDoc = await getDoc(roomDocRef);
        const myPlayerData = {
            username: username,
            score: 0,
            isOnline: true,
            lastSeen: Timestamp.now() // ★追加: 生存確認用のタイムスタンプ
        };

        flowingCommentIds.clear();

        if (roomDoc.exists()) {
            const existingData = roomDoc.data();
            
            if (existingData.messages && Array.isArray(existingData.messages)) {
                existingData.messages.forEach(msg => {
                    if (msg.timestamp) {
                        const msgId = msg.timestamp.toMillis() + (msg.text || ''); 
                        flowingCommentIds.add(msgId);
                    }
                });
            }

            const onlinePlayers = Object.values(existingData.players || {}).filter(p => p.isOnline);

            if (onlinePlayers.length === 0) {
                console.log("オンラインのプレイヤーがいないため、ルームをリセットします。");
                await resetRoom(roomDocRef, myPlayerData, username);
                flowingCommentIds.clear();
            } else {
                await updateDoc(roomDocRef, {
                    [`players.${currentUser.uid}`]: myPlayerData
                });
            }
        } else {
            console.log("新しいルームを作成します。");
            await resetRoom(roomDocRef, myPlayerData, username);
        }

        setupRoomListener(roomDocRef);
        startHeartbeat(); // ★追加: ハートビート開始

        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        roomIdDisplay.textContent = currentRoomId;
        loadingModal.classList.add('hidden');

    } catch (error) {
        console.error("ルームへの参加に失敗しました:", error);
        alert("ルームへの参加に失敗しました。");
        loadingModal.classList.add('hidden');
        currentRoomId = null;
    }
}

async function resetRoom(roomDocRef, myPlayerData, username) {
    const customRules = {};
    for (const key in rulesCheckboxes) {
        customRules[key] = rulesCheckboxes[key].checked;
    }

    const newRoomData = {
        gameState: "waiting",
        currentWord: "",
        normalizedWord: "",
        currentDrawerId: currentUser.uid,
        drawingData: [],
        messages: [],
        players: {
            [currentUser.uid]: myPlayerData
        },
        customRules: customRules,
        turnStartTime: null,
        lastWinner: null,
        pointsAwarded: 0
    };

    await setDoc(roomDocRef, newRoomData);
}

function setupRoomListener(roomDocRef) {
    if (roomUnsubscribe) {
        roomUnsubscribe();
    }

    roomUnsubscribe = onSnapshot(roomDocRef, (doc) => {
        if (!doc.exists()) {
            console.log("ルームが削除されました。");
            handleLeaveRoom(true);
            return;
        }

        const oldGameState = roomData ? roomData.gameState : null;
        roomData = doc.data();
        isDrawer = roomData.currentDrawerId === currentUser.uid;

        console.log("ルームデータ更新:", roomData);

        // ★追加: ゴーストユーザー（切断されたプレイヤー）のチェックと削除
        checkAndRemoveGhosts(roomData);

        updateScoreboard();
        updateMessages(); 
        handleNewMessagesFlow(roomData.messages || []);
        updateUIForGameState(oldGameState);
        redrawCanvas();

    }, (error) => {
        console.error("ルームの監視に失敗しました:", error);
        alert("ルームとの接続が切れました。");
        handleLeaveRoom(false);
    });
}

async function handleLeaveRoom(silent = false) {
    stopHeartbeat(); // ★追加: ハートビート停止

    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }

    if (currentRoomId && currentUser) {
        const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
        try {
            await updateDoc(roomDocRef, {
                [`players.${currentUser.uid}.isOnline`]: false
            });
            console.log("退室しました。");
        } catch (error) {
            console.error("退室処理に失敗しました:", error);
        }
    }

    gameScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    
    currentRoomId = null;
    roomData = null;
    isDrawer = false;

    if (!silent) {
        // alert("退室しました。");
    }
}

// -------------------------------------------------------------------
// ハートビート & ゴースト対策関数
// -------------------------------------------------------------------

// 1分ごとに lastSeen を更新する
function startHeartbeat() {
    stopHeartbeat(); // 二重起動防止
    // 初回実行
    sendHeartbeat();
    // 定期実行
    heartbeatInterval = setInterval(sendHeartbeat, 60000); 
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

async function sendHeartbeat() {
    if (!currentRoomId || !currentUser) return;
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        // 自分の lastSeen を現在時刻で更新
        await updateDoc(roomDocRef, {
            [`players.${currentUser.uid}.lastSeen`]: Timestamp.now()
        });
    } catch (error) {
        console.error("生存報告に失敗しました（無視可能）:", error);
    }
}

// ゴースト（長期間応答がないプレイヤー）を検知して強制退室させる
function checkAndRemoveGhosts(data) {
    if (!data || !data.players || !currentUser) return;

    const now = Timestamp.now().seconds;
    const threshold = 180; // 180秒（3分）以上更新がなければオフラインとみなす

    const onlinePlayers = Object.entries(data.players)
        .filter(([, p]) => p.isOnline)
        .map(([uid, p]) => ({ uid, ...p }));

    if (onlinePlayers.length === 0) return;

    // 競合を防ぐため、オンラインプレイヤーの中で「UIDが辞書順で最小」の人が代表して掃除を行う
    onlinePlayers.sort((a, b) => a.uid.localeCompare(b.uid));
    const cleaner = onlinePlayers[0];

    // 自分が掃除役でなければ何もしない
    if (cleaner.uid !== currentUser.uid) return;

    // ゴースト認定
    const ghosts = onlinePlayers.filter(p => {
        if (!p.lastSeen) return false; // データがない場合は一旦スルー
        const diff = now - p.lastSeen.seconds;
        return diff > threshold;
    });

    if (ghosts.length > 0) {
        console.log("ゴーストを検出しました:", ghosts.map(g => g.username));
        removeGhosts(ghosts);
    }
}

async function removeGhosts(ghosts) {
    if (!currentRoomId) return;
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    const batch = writeBatch(db);

    ghosts.forEach(g => {
        batch.update(roomDocRef, {
            [`players.${g.uid}.isOnline`]: false
        });
    });

    try {
        await batch.commit();
        console.log(`${ghosts.length} 人のゴーストを退室させました。`);
    } catch (error) {
        console.error("ゴースト駆除に失敗:", error);
    }
}

// -------------------------------------------------------------------

function updateScoreboard() {
    if (!roomData || !roomData.players) return;

    const players = Object.entries(roomData.players)
        .filter(([, playerData]) => playerData.isOnline) 
        .sort(([, a], [, b]) => b.score - a.score); 

    scoreboardContainer.innerHTML = '';
    players.forEach(([uid, playerData]) => {
        const isMe = uid === currentUser.uid;
        const isCurrentDrawer = uid === roomData.currentDrawerId;

        const playerEl = document.createElement('div');
        playerEl.className = `flex justify-between items-center p-1 rounded-md ${isMe ? 'font-bold bg-blue-100' : ''}`;
        
        let drawerIcon = '';
        if (isCurrentDrawer && (roomData.gameState === 'drawing' || roomData.gameState === 'waiting')) {
            drawerIcon = ' ✏️';
        }

        playerEl.innerHTML = `
            <span>${playerData.username}${drawerIcon}</span>
            <span class="text-lg font-semibold">${playerData.score}</span>
        `;
        scoreboardContainer.appendChild(playerEl);
    });
}

function updateMessages() {
    if (!roomData || !roomData.messages) return;

    messagesContainer.innerHTML = '';
    const recentMessages = roomData.messages.length > 50 
        ? roomData.messages.slice(-50) 
        : roomData.messages;
    roomData.messages.forEach(msg => {
        appendMessage(msg);
    });
    // messagesContainer.scrollTop = messagesContainer.scrollHeight; // reverse-columnなのでスクロール制御不要または逆
}

function appendMessage(msg) {
    const msgEl = document.createElement('div');
    msgEl.classList.add('mb-1', 'text-sm', 'break-words');

    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'font-semibold';
    usernameSpan.textContent = msg.username ? `${msg.username}: ` : '';

    const textSpan = document.createElement('span');
    textSpan.textContent = msg.text;

    if (msg.type === 'system' || msg.type === 'pass') {
        msgEl.className = 'mb-1 text-sm italic text-gray-500';
        textSpan.textContent = `📢 ${msg.text}`;
    } else if (msg.type === 'correct') {
        msgEl.className = 'mb-1 text-sm font-bold text-green-600';
        textSpan.textContent = `🎉 ${msg.username} が正解しました！`;
    }

    if (msg.username) {
        msgEl.appendChild(usernameSpan);
    }
    msgEl.appendChild(textSpan);
    
    messagesContainer.appendChild(msgEl);
}

function handleNewMessagesFlow(messages) {
    if (!roomData || !roomData.customRules.flowingComments) return;

    messages.forEach(msg => {
        if (!msg.timestamp) return; 

        const msgId = msg.timestamp.toMillis() + (msg.text || ''); 
        
        if (!flowingCommentIds.has(msgId)) {
            createFlowingComment(msg);
            flowingCommentIds.add(msgId);
        }
    });
}

function updateUIForGameState(oldGameState) {
    if (!roomData) return;

    const state = roomData.gameState;
    
    dictionarySearchContainer.classList.toggle('hidden', !roomData.customRules.dictionarySearch || isDrawer);

    if (state === 'waiting') {
        currentWordDisplay.textContent = '待機中...';
        drawingToolbar.classList.add('hidden');
        answerInput.placeholder = 'チャットを入力...';
        answerInput.disabled = false;
        resultModal.classList.add('hidden');
        
        const isFirstTurnEver = roomData.messages.length === 0;
        gameStartBtn.classList.toggle('hidden', !isDrawer || !isFirstTurnEver);

        if (oldGameState === 'result' && isDrawer) {
            console.log("自動で次のターンを開始します。");
            startNewTurn(); 
        }

    } else if (state === 'drawing') {
        gameStartBtn.classList.add('hidden'); 
        resultModal.classList.add('hidden');
        
        if (isDrawer) {
            currentWordDisplay.textContent = roomData.currentWord || 'お題取得中...';
            drawingToolbar.classList.remove('hidden');
            answerInput.placeholder = '（出題者は回答できません）';
            answerInput.disabled = true;
        } else {
            if (roomData.customRules.wordHint && roomData.currentWord) {
                currentWordDisplay.textContent = '〇'.repeat(roomData.currentWord.length);
            } else {
                currentWordDisplay.textContent = 'お題は...';
            }
            drawingToolbar.classList.add('hidden');
            answerInput.placeholder = '回答を入力...';
            answerInput.disabled = false;
        }

        if (oldGameState !== 'drawing' && isDrawer && roomData.customRules.showImageBefore) {
            showImageModalFunc(roomData.currentWord);
        }

    } else if (state === 'result') {
        currentWordDisplay.textContent = `正解: ${roomData.currentWord}`;
        drawingToolbar.classList.add('hidden');
        answerInput.placeholder = 'チャットを入力...';
        answerInput.disabled = false;
        
        if (oldGameState !== 'result') {
            showResultModal();
            
            if (isDrawer) {
                setTimeout(startNextTurn, 5000);
            }
        }
    }
}

function showResultModal() {
    if (!roomData || !roomData.lastWinner) return;
    
    resultWinner.textContent = `${roomData.lastWinner.username} さんが正解しました！`;
    resultWord.textContent = `お題: ${roomData.currentWord}`;
    resultPoints.textContent = `出題者と正解者に +${roomData.pointsAwarded} ポイント！`;
    
    if (roomData.customRules.showImageAfter) {
        const imageUrl = getCardImageUrl(roomData.currentWord);
        resultImage.src = imageUrl;
        resultImage.onerror = () => { resultImage.src = 'https://placehold.co/300x420/eee/ccc?text=No+Image'; };
        resultImageContainer.classList.remove('hidden');
    } else {
        resultImageContainer.classList.add('hidden');
    }

    resultModal.classList.remove('hidden');
}

function showImageModalFunc(word) {
    if (!word) return;
    const imageUrl = getCardImageUrl(word);
    showImageWord.textContent = word;
    showImageImg.src = imageUrl;
    showImageImg.onerror = () => { showImageImg.src = 'https://placehold.co/300x420/eee/ccc?text=No+Image'; };
    showImageModal.classList.remove('hidden');
}

function createFlowingComment(msg) {
    if (!roomData.customRules.flowingComments) return;

    const item = document.createElement('div');
    item.classList.add('comment-flow-item');
    
    let text = '';
    if (msg.type === 'system' || msg.type === 'pass') {
        text = `📢 ${msg.text}`;
    } else if (msg.type === 'correct') {
        text = `🎉 ${msg.username} が正解！`;
    } else {
        text = `${msg.username}: ${msg.text}`;
    }
    item.textContent = text;

    item.style.top = `${Math.floor(Math.random() * 70) + 5}%`; 

    commentFlowContainer.appendChild(item);

    item.addEventListener('animationend', () => {
        item.remove();
    });
}

async function fetchDictionary() {
    if (dictionaryFetched) return;
    
    dictionaryFetched = true; 

    const url = 'https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/all_card_names.txt';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('辞書の読み込みに失敗しました。');
        const text = await response.text();
        dictionary = text.split('\n').filter(Boolean); 
        console.log(`辞書を読み込みました: ${dictionary.length} 件`);
    } catch (error) {
        dictionaryFetched = false; 
        console.error(error);
        alert("お題辞書の読み込みに失敗しました。");
    }
}

async function handleGameStart() {
    if (!isDrawer) return;
    await startNewTurn();
}

async function startNewTurn() {
    if (!isDrawer) return;
    if (!dictionaryFetched) { 
        await fetchDictionary(); 
    }
    if (dictionary.length === 0) {
        alert("辞書が空か、読み込みに失敗しました。");
        return;
    }

    const newWord = dictionary[Math.floor(Math.random() * dictionary.length)];
    const normalizedWord = normalizeText(newWord);

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    
    try {
        await updateDoc(roomDocRef, {
            gameState: "drawing",
            currentWord: newWord,
            normalizedWord: normalizedWord,
            drawingData: [], 
            turnStartTime: Timestamp.now(), 
            messages: arrayUnion({ 
                type: "system",
                text: `${roomData.players[currentUser.uid].username} が描いています。`,
                timestamp: Timestamp.now()
            })
        });
    } catch (error) {
        console.error("ターン開始に失敗:", error);
    }
}

async function startNextTurn() {
    if (!isDrawer || roomData.gameState !== 'result') return;

    const nextDrawerId = findNextDrawer();
    
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomDocRef, {
            currentDrawerId: nextDrawerId,
            gameState: "waiting", 
            currentWord: "",
            normalizedWord: "",
            drawingData: [],
            turnStartTime: null,
            lastWinner: null,
            pointsAwarded: 0
        });

        console.log(`次の出題者: ${nextDrawerId}`);

    } catch (error) {
        console.error("次のターンの準備に失敗:", error);
    }
}

function findNextDrawer() {
    const onlinePlayers = Object.entries(roomData.players)
        .filter(([, p]) => p.isOnline)
        .map(([uid]) => uid); 
    
    if (onlinePlayers.length === 0) {
        return currentUser.uid; 
    }
    
    const currentIndex = onlinePlayers.indexOf(roomData.currentDrawerId);
    if (currentIndex === -1) {
        return onlinePlayers[0];
    }

    const nextIndex = (currentIndex + 1) % onlinePlayers.length;
    
    return onlinePlayers[nextIndex];
}

async function handlePass() {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomDocRef, {
        messages: arrayUnion({
            type: "pass",
            username: roomData.players[currentUser.uid].username,
            text: "出題者がパスしました。お題を変更します。",
            timestamp: Timestamp.now()
        })
    });

    await startNewTurn();
}

async function handleClearCanvas() {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomDocRef, {
        drawingData: [] 
    });
}

async function handleAnswerSubmit(e) {
    e.preventDefault();
    const text = answerInput.value.trim();
    if (!text || !roomData) return;

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    const myUsername = roomData.players[currentUser.uid].username;

    let messageData = {
        userId: currentUser.uid,
        username: myUsername,
        text: text,
        timestamp: Timestamp.now()
    };
    
    if (roomData.gameState === 'drawing' && !isDrawer) {
        const normalizedAnswer = normalizeText(text);
        
        if (normalizedAnswer === roomData.normalizedWord) {
            await handleCorrectAnswer(messageData);
            answerInput.value = ''; 
            return;
        } else {
            messageData.type = "answer";
        }
    } else {
        messageData.type = "chat";
    }

    try {
        await updateDoc(roomDocRef, {
            messages: arrayUnion(messageData)
        });
        answerInput.value = ''; 
    } catch (error) {
        console.error("メッセージの送信に失敗:", error);
    }
}

async function handleCorrectAnswer(correctMessage) {
    if (roomData.gameState !== 'drawing') {
        console.log("競合: すでに正解処理が実行されています。");
        return;
    }

    const elapsedSeconds = Timestamp.now().seconds - roomData.turnStartTime.seconds;
    const points = Math.max(20, 100 - Math.floor(elapsedSeconds / 2));

    const winnerId = correctMessage.userId;
    const drawerId = roomData.currentDrawerId;

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    
    const systemCorrectMessage = {
        type: "correct",
        username: correctMessage.username,
        text: `${correctMessage.username} が正解しました！`, 
        timestamp: Timestamp.now()
    };

    try {
        const batch = writeBatch(db);
        
        batch.update(roomDocRef, {
            gameState: "result",
            lastWinner: {
                userId: winnerId,
                username: correctMessage.username
            },
            pointsAwarded: points,
            
            [`players.${winnerId}.score`]: increment(points),
            [`players.${drawerId}.score`]: increment(points),

            messages: arrayUnion(correctMessage, systemCorrectMessage)
        });

        await batch.commit();

    } catch (error) {
        console.error("正解処理に失敗:", error);
    }
}

function handleDictionarySearch() {
    if (!dictionaryFetched || dictionary.length === 0) return;
    
    const query = normalizeText(dictionarySearchInput.value.trim());
    if (query.length < 1) {
        dictionarySearchResults.innerHTML = '';
        return;
    }

    const results = dictionary.filter(word => {
        return normalizeText(word).includes(query);
    }).slice(0, 10); 

    dictionarySearchResults.innerHTML = '';
    if (results.length === 0) {
        dictionarySearchResults.innerHTML = '<div class="p-2 text-gray-500">一致するカード名がありません</div>';
        return;
    }

    results.forEach(word => {
        const item = document.createElement('div');
        item.className = 'p-2 hover:bg-gray-100 cursor-pointer';
        item.textContent = word;
        item.dataset.word = word;
        dictionarySearchResults.appendChild(item);
    });
}

function startDrawing(e) {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    isDrawing = true;

    const { x, y } = getMousePos(e);
    lastX = x;
    lastY = y;

    strokeBuffer.push({
        type: 'start',
        x: x,
        y: y,
        color: currentColor,
        width: currentLineWidth
    });

    drawOnCanvas({ type: 'start', x: x, y: y, color: currentColor, width: currentLineWidth });
    drawOnCanvas({ type: 'draw', x: x, y: y });
}

function draw(e) {
    if (!isDrawing) return;

    const { x, y } = getMousePos(e);
    
    strokeBuffer.push({
        type: 'draw',
        x: x,
        y: y
    });

    drawOnCanvas({ type: 'start', x: lastX, y: lastY, color: currentColor, width: currentLineWidth });
    drawOnCanvas({ type: 'draw', x: x, y: y });

    lastX = x;
    lastY = y;

    if (!bufferTimer) {
        bufferTimer = setTimeout(sendBuffer, 100); 
    }
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    
    if (bufferTimer) {
        clearTimeout(bufferTimer);
        bufferTimer = null;
    }
    sendBuffer();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
    const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

async function sendBuffer() {
    if (bufferTimer) {
        clearTimeout(bufferTimer);
        bufferTimer = null;
    }

    if (strokeBuffer.length === 0 || !currentRoomId) return;

    const bufferToSend = [...strokeBuffer]; 
    strokeBuffer = []; 

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomDocRef, {
            drawingData: arrayUnion(...bufferToSend)
        });
    } catch (error) {
        console.error("描画データの送信に失敗:", error);
        strokeBuffer = [...bufferToSend, ...strokeBuffer];
    }
}

function redrawCanvas() {
    if (!ctx || !roomData || !roomData.drawingData) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    roomData.drawingData.forEach(stroke => {
        drawOnCanvas(stroke);
    });
}

function drawOnCanvas(stroke) {
    if (!ctx) return;
    
    if (stroke.type === 'start') {
        ctx.beginPath();
        ctx.moveTo(stroke.x, stroke.y);
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineTo(stroke.x, stroke.y);
        ctx.stroke();
    } else if (stroke.type === 'draw') {
        ctx.lineTo(stroke.x, stroke.y);
        ctx.stroke();
    }
}

function setCurrentColor(color) {
    currentColor = color;
    colorPicker.value = color; 

    quickColorPalette.querySelectorAll('.quick-color').forEach(btn => {
        btn.classList.toggle('border-gray-400', btn.dataset.color === color);
        btn.classList.toggle('border-2', btn.dataset.color === color);
    });
}

function handleCheckWord() {
    if (!isDrawer || !roomData || !roomData.currentWord) return;
    
    showImageModalFunc(roomData.currentWord);
}

function normalizeText(text) {
    if (!text) return "";
    return text
        .trim()
        .toLowerCase()
        .replace(/[\u30a1-\u30f6]/g, (match) => {
            return String.fromCharCode(match.charCodeAt(0) - 0x60);
        })
        .replace(/[\s\u3000!-/:-@[-`{-~、。ー]/g, ''); 
}

function getCardImageUrl(cardName) {
    if (!cardName) return '';
    const encodedName = encodeURIComponent(cardName);
    return `https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/images/captured_cards/${encodedName}.png`;
}