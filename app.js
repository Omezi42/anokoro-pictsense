import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, collection, doc, getDoc, setDoc, updateDoc, onSnapshot, 
    arrayUnion, serverTimestamp, increment, deleteDoc, runTransaction 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. Firebase Config (プレースホルダー)
const firebaseConfig = {
  apiKey: "AIzaSyAbb-B4IaknBvhJDs1Nw2RymsLSqTQSyn8",
  authDomain: "anokoro-pictsense.firebaseapp.com",
  projectId: "anokoro-pictsense",
  storageBucket: "anokoro-pictsense.firebasestorage.app",
  messagingSenderId: "769791445375",
  appId: "1:769791445375:web:76047b7ec3871dbe27f24a"
};

// アプリ初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 定数・状態変数
const DICT_URL = "https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/all_card_names.txt";
const IMAGE_BASE_URL = "https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/images/captured_cards/";
const COLORS = [
    '#000000', '#ffffff', '#808080', '#ff0000', '#ffa500', 
    '#ffff00', '#008000', '#00ffff', '#0000ff', '#800080', 
    '#ffc0cb', '#8b4513'
];

let currentUser = null;
let currentRoomId = null;
let currentRoomData = null;
let unsubscribeRoom = null;
let cardDictionary = [];
let isDrawing = false;
let lastPoint = null;
let strokeBuffer = []; 
let sendTimer = null; 

// ローカル設定
let drawingColor = '#000000';
let drawingSize = 3;
let isEraser = false;

// DOM要素
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const chatHistory = document.getElementById('chat-history');

// -------------------------------------------------------
// 1. 初期化と辞書ロード
// -------------------------------------------------------
async function init() {
    try {
        const res = await fetch(DICT_URL);
        const text = await res.text();
        cardDictionary = text.split(/\r\n|\n/).filter(line => line.trim() !== "");
        console.log(`Dictionary loaded: ${cardDictionary.length} words.`);
    } catch (e) {
        console.error("Failed to load dictionary", e);
        alert("辞書の読み込みに失敗しました。");
    }

    signInAnonymously(auth).catch((error) => {
        console.error("Auth failed", error);
        alert("認証に失敗しました。");
    });

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("Signed in as", user.uid);
        }
    });

    setupUI();
    setupCanvas();
}

// -------------------------------------------------------
// 2. UIセットアップ
// -------------------------------------------------------
function setupUI() {
    document.getElementById('join-btn').addEventListener('click', joinRoom);
    document.getElementById('leave-btn').addEventListener('click', leaveRoom);
    document.getElementById('start-game-btn').addEventListener('click', startGame);
    document.getElementById('ranking-btn').addEventListener('click', showRanking);
    document.getElementById('chat-send-btn').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });

    const searchInput = document.getElementById('dict-search');
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const list = document.getElementById('search-results');
        list.innerHTML = '';
        if (!val) return;
        
        const hits = cardDictionary.filter(word => word.includes(val)).slice(0, 20);
        hits.forEach(word => {
            const div = document.createElement('div');
            div.className = "p-2 hover:bg-blue-50 cursor-pointer text-xs border-b border-gray-200 text-gray-700";
            div.textContent = word;
            div.onclick = () => {
                document.getElementById('chat-input').value = word;
                document.getElementById('chat-input').focus();
            };
            list.appendChild(div);
        });
    });

    const palette = document.getElementById('color-palette');
    COLORS.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `w-6 h-6 rounded-full border border-gray-300 tool-btn`;
        btn.style.backgroundColor = color;
        btn.onclick = () => setColor(color, btn);
        palette.appendChild(btn);
    });
    setColor('#000000', palette.children[0]);

    document.getElementById('color-picker').addEventListener('change', (e) => setColor(e.target.value));
    document.getElementById('line-width').addEventListener('input', (e) => drawingSize = parseInt(e.target.value));
    
    document.getElementById('eraser-btn').addEventListener('click', () => {
        isEraser = true;
        updateToolStyles();
    });
    
    document.getElementById('clear-btn').addEventListener('click', clearCanvasRemotely);
    document.getElementById('pass-btn').addEventListener('click', passTurn);
    document.getElementById('show-ref-btn').addEventListener('click', () => showImageModal(currentRoomData.currentWord, 'check'));
}

function setColor(color, btnElement = null) {
    isEraser = false;
    drawingColor = color;
    document.querySelectorAll('#color-palette .tool-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    document.getElementById('color-picker').value = color;
    updateToolStyles();
}

function updateToolStyles() {
    const eraserBtn = document.getElementById('eraser-btn');
    if (isEraser) {
        eraserBtn.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-700');
        eraserBtn.classList.remove('bg-gray-100', 'border-gray-300', 'text-gray-700');
    } else {
        eraserBtn.classList.remove('bg-yellow-100', 'border-yellow-400', 'text-yellow-700');
        eraserBtn.classList.add('bg-gray-100', 'border-gray-300', 'text-gray-700');
    }
}

// -------------------------------------------------------
// 3. ルームロジック (Firestore)
// -------------------------------------------------------
async function joinRoom() {
    const username = document.getElementById('username-input').value.trim();
    const roomId = document.getElementById('room-id-input').value.trim();
    if (!username || !roomId) return alert("ユーザー名とルームIDを入力してください");

    currentRoomId = roomId;
    const roomRef = doc(db, "pictsenseRooms", roomId);

    const settings = {
        enableSearch: document.getElementById('opt-search').checked,
        showImageStart: document.getElementById('opt-show-start').checked,
        showImageResult: document.getElementById('opt-show-result').checked,
        flowComments: document.getElementById('opt-flow').checked,
        showHints: document.getElementById('opt-hint').checked
    };

    try {
        const roomDoc = await getDoc(roomRef);
        
        if (!roomDoc.exists()) {
            await setDoc(roomRef, {
                status: "waiting",
                players: [{
                    uid: currentUser.uid,
                    name: username,
                    score: 0,
                    isOnline: true,
                    isCreator: true
                }],
                currentDrawerUid: null,
                currentWord: null,
                startTime: null,
                canvasData: [],
                messages: [],
                settings: settings
            });
        } else {
            const data = roomDoc.data();
            const onlinePlayers = (data.players || []).filter(p => p.isOnline);
            if (onlinePlayers.length === 0) {
                await setDoc(roomRef, {
                    status: "waiting",
                    players: [{
                        uid: currentUser.uid,
                        name: username,
                        score: 0,
                        isOnline: true,
                        isCreator: true
                    }],
                    currentDrawerUid: null,
                    currentWord: null,
                    startTime: null,
                    canvasData: [],
                    messages: [],
                    settings: settings
                });
            } else {
                const existingPlayerIndex = data.players.findIndex(p => p.uid === currentUser.uid);
                let newPlayers = [...data.players];
                
                if (existingPlayerIndex >= 0) {
                    newPlayers[existingPlayerIndex].isOnline = true;
                    newPlayers[existingPlayerIndex].name = username;
                } else {
                    newPlayers.push({
                        uid: currentUser.uid,
                        name: username,
                        score: 0,
                        isOnline: true,
                        isCreator: false
                    });
                }
                await updateDoc(roomRef, { players: newPlayers });
            }
        }

        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('game-screen').classList.add('flex');
        document.getElementById('disp-room-id').textContent = roomId;

        if (settings.enableSearch) {
            document.getElementById('search-column').classList.remove('hidden');
        }

        subscribeToRoom(roomId);

    } catch (e) {
        console.error(e);
        alert("ルームへの参加に失敗しました: " + e.message);
    }
}

function subscribeToRoom(roomId) {
    const roomRef = doc(db, "pictsenseRooms", roomId);
    unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const prevData = currentRoomData;
        currentRoomData = data;

        updateGameUI(data, prevData);
    });
}

async function leaveRoom() {
    if (!currentRoomId || !currentUser) return;
    if (unsubscribeRoom) unsubscribeRoom();

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        const docSnap = await getDoc(roomRef);
        if (docSnap.exists()) {
            const players = docSnap.data().players.map(p => {
                if (p.uid === currentUser.uid) return { ...p, isOnline: false };
                return p;
            });
            await updateDoc(roomRef, { players });
        }
    } catch(e) { console.error(e); }
    location.reload();
}

// -------------------------------------------------------
// 4. ゲーム進行・同期ロジック
// -------------------------------------------------------
function updateGameUI(data, prevData) {
    const isMeDrawer = data.currentDrawerUid === currentUser.uid;
    const me = data.players.find(p => p.uid === currentUser.uid);
    const isCreator = me?.isCreator || false;

    // ステータス表示など
    const statusText = document.getElementById('game-status-text');
    const startOverlay = document.getElementById('start-game-overlay');
    const topicText = document.getElementById('topic-text');

    if (data.status === 'waiting') {
        statusText.textContent = "待機中";
        statusText.className = "text-xs font-bold bg-gray-200 text-gray-600 px-2 py-1 rounded-full";
        if (isCreator) {
            startOverlay.classList.remove('hidden');
        } else {
            startOverlay.classList.add('hidden');
        }
        topicText.textContent = "WAITING";
        document.getElementById('toolbar').classList.add('hidden');
        document.getElementById('timer-display').classList.add('hidden');
    } else if (data.status === 'playing') {
        statusText.textContent = "出題中";
        statusText.className = "text-xs font-bold bg-green-100 text-green-600 px-2 py-1 rounded-full animate-pulse";
        startOverlay.classList.add('hidden');
        document.getElementById('timer-display').classList.remove('hidden');
        
        if (data.startTime) {
            const elapsed = Math.floor((Date.now() - data.startTime.toMillis()) / 1000);
            const currentScore = Math.max(10, 100 - Math.floor(elapsed / 2));
            document.getElementById('timer-display').textContent = currentScore;
        }

        if (isMeDrawer) {
            topicText.textContent = data.currentWord || "???";
            document.getElementById('toolbar').classList.remove('hidden');
            // ターン開始直後の画像表示
            if (data.settings.showImageStart && (!prevData || prevData.currentWord !== data.currentWord)) {
                showImageModal(data.currentWord, 'start');
            }
        } else {
            document.getElementById('toolbar').classList.add('hidden');
            if (data.settings.showHints && data.currentWord) {
                let hint = "";
                for(let i=0; i<data.currentWord.length; i++) hint += "〇";
                topicText.textContent = hint;
            } else {
                topicText.textContent = "？？？";
            }
        }

        // 出題者のオフラインチェック
        checkDrawerStatus(data);
    }

    // キャンバス同期
    const prevLen = prevData ? prevData.canvasData.length : 0;
    if (data.canvasData.length !== prevLen || !prevData) {
        redrawCanvas(data.canvasData);
    }

    // チャット同期
    const prevMsgLen = prevData ? prevData.messages.length : 0;
    if (data.messages.length > prevMsgLen) {
        const newMessages = data.messages.slice(prevMsgLen);
        // prevDataが存在する場合のみ(差分更新時のみ)流す
        const shouldFlow = data.settings.flowComments && !!prevData;

        newMessages.forEach(msg => addChatMessage(msg, shouldFlow));
    }
    
    if (!document.getElementById('ranking-modal').classList.contains('hidden')) {
        showRanking();
    }
}

// 出題者がオフラインなら次へ飛ばすロジック
function checkDrawerStatus(data) {
    if (data.status !== 'playing') return;
    const drawer = data.players.find(p => p.uid === data.currentDrawerUid);
    
    // 自分がオンラインプレイヤーの先頭(管理者役)の場合のみ実行
    const onlinePlayers = data.players.filter(p => p.isOnline);
    const amILeader = onlinePlayers.length > 0 && onlinePlayers[0].uid === currentUser.uid;

    if (drawer && !drawer.isOnline && amILeader) {
        console.log("Drawer is offline. Force next turn.");
        
        // SYSTEMメッセージを出してから次へ
        const roomRef = doc(db, "pictsenseRooms", currentRoomId);
        updateDoc(roomRef, {
            messages: arrayUnion({
                user: "SYSTEM",
                text: "出題者がオフラインのため、順番をスキップします。",
                timestamp: Date.now()
            })
        }).then(() => {
             nextTurn(); // 引数なしで呼べるように変更済み
        });
    }
}

async function startGame() {
    if (!currentRoomId) return;
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    const word = getRandomWord();
    
    await updateDoc(roomRef, {
        status: "playing",
        currentDrawerUid: currentUser.uid,
        currentWord: word,
        startTime: serverTimestamp(),
        canvasData: [],
        messages: arrayUnion({
            user: "SYSTEM",
            text: "ゲームが開始されました！",
            timestamp: Date.now()
        })
    });
}

async function passTurn() {
    if (!currentRoomId) return;
    const word = getRandomWord();
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomRef, {
        currentWord: word,
        canvasData: [],
        messages: arrayUnion({
            user: "SYSTEM",
            text: "お題がパスされました。",
            timestamp: Date.now()
        })
    });
}

// ★修正ポイント: トランザクションを使って排他制御を行う
async function handleCorrectAnswer(winnerName, winnerUid) {
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);

    try {
        // トランザクション実行
        await runTransaction(db, async (transaction) => {
            const roomDoc = await transaction.get(roomRef);
            if (!roomDoc.exists()) throw "Document does not exist!";
            
            const data = roomDoc.data();
            
            // ★重要: 既に誰かが正解して status が playing 以外になっていたら何もしない（早い者勝ち）
            if (data.status !== 'playing') {
                console.log("Already answered/processed by someone else.");
                return; 
            }

            // スコア計算
            const now = Date.now();
            const start = data.startTime ? data.startTime.toMillis() : now;
            const elapsed = (now - start) / 1000;
            const scoreToAdd = Math.max(10, 100 - Math.floor(elapsed / 2));

            // プレイヤー更新
            let updatedPlayers = [...data.players];
            updatedPlayers = updatedPlayers.map(p => {
                if (p.uid === winnerUid) return { ...p, score: p.score + scoreToAdd }; // 正解者
                if (p.uid === data.currentDrawerUid) return { ...p, score: p.score + scoreToAdd }; // 出題者
                return p;
            });

            // 書き込み (status を 'result' に変更してロックする)
            transaction.update(roomRef, {
                status: "result", // ★状態を変更してロック
                players: updatedPlayers,
                messages: arrayUnion({
                    user: "SYSTEM",
                    text: `${winnerName}さんが正解しました！ (答え: ${data.currentWord}) +${scoreToAdd}pt`,
                    word: data.currentWord,
                    timestamp: Date.now(),
                    isAnswer: true
                })
            });
        });

        // トランザクションに成功した(=ステータスを更新した)クライアントだけが次へ進むタイマーをセット
        setTimeout(() => nextTurn(), 5000);

    } catch (e) {
        console.log("Transaction skipped or failed: ", e);
    }
}

async function nextTurn() {
    if (!currentRoomId) return;
    // 現在の状態を再取得（念のため）
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    const snap = await getDoc(roomRef);
    if(!snap.exists()) return;
    const data = snap.data();
    
    // オンラインプレイヤーから次の出題者を探す
    const onlinePlayers = data.players.filter(p => p.isOnline);
    if (onlinePlayers.length === 0) return;

    let currentIndex = onlinePlayers.findIndex(p => p.uid === data.currentDrawerUid);
    let nextIndex = (currentIndex + 1) % onlinePlayers.length;
    const nextDrawer = onlinePlayers[nextIndex];
    const word = getRandomWord();

    await updateDoc(roomRef, {
        status: "playing", // ここで playing に戻す
        currentDrawerUid: nextDrawer.uid,
        currentWord: word,
        startTime: serverTimestamp(),
        canvasData: [],
        messages: arrayUnion({
            user: "SYSTEM",
            text: `次は ${nextDrawer.name} さんの番です！`,
            timestamp: Date.now()
        })
    });
}

function getRandomWord() {
    if (cardDictionary.length === 0) return "読み込み中";
    return cardDictionary[Math.floor(Math.random() * cardDictionary.length)];
}

// -------------------------------------------------------
// 5. チャット機能
// -------------------------------------------------------
async function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (!currentRoomId) return;

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    const me = currentRoomData.players.find(p => p.uid === currentUser.uid);
    const name = me ? me.name : "Unknown";

    // 回答判定 (出題中は回答できない)
    if (currentRoomData.status === 'playing' && 
        currentRoomData.currentDrawerUid !== currentUser.uid && 
        text === currentRoomData.currentWord) {
        
        // 先にチャット送信（正解コメント）
        input.value = '';
        await updateDoc(roomRef, {
            messages: arrayUnion({
                user: name,
                text: text,
                timestamp: Date.now(),
                isCorrectComment: true // 正解コメントフラグ
            })
        });

        // ★正解処理（トランザクション）へ
        handleCorrectAnswer(name, currentUser.uid);
        return;
    }

    // 通常チャット
    await updateDoc(roomRef, {
        messages: arrayUnion({
            user: name,
            text: text,
            timestamp: Date.now()
        })
    });
    input.value = '';
}

function addChatMessage(msg, flowEnabled) {
    const div = document.createElement('div');
    div.className = "bg-gray-50 p-2 rounded text-sm border border-gray-200 text-gray-800 shadow-sm";
    
    if (msg.user === "SYSTEM") {
        div.className = "bg-yellow-50 p-2 rounded text-sm border border-yellow-200 text-gray-800 shadow-sm";
        div.innerHTML = `<span class="font-bold text-yellow-600">★SYSTEM</span>: ${msg.text}`;
        
        // システムメッセージも流す
        if (flowEnabled) {
            flowComment(msg.text, "SYSTEM", "system");
        }

        // 正解時の画像表示トリガー
        if (flowEnabled && msg.isAnswer && currentRoomData.settings.showImageResult) {
            const targetWord = msg.word || currentRoomData.currentWord;
            showImageModal(targetWord, 'result');
        }

    } else {
        if (msg.isCorrectComment) {
            // 正解コメントは特別色
            div.className = "bg-green-50 p-2 rounded text-sm border border-green-200 text-gray-800 shadow-sm border-l-4 border-l-green-500";
            div.innerHTML = `<span class="font-bold text-green-600">${msg.user}</span>: <span class="font-bold text-xl text-green-700">${msg.text}</span> <span class="text-xs bg-green-500 text-white px-1 rounded">正解！</span>`;
            
            if (flowEnabled) {
                flowComment(msg.text + " (正解!)", msg.user, "correct");
            }
        } else {
            // 通常
            div.innerHTML = `<span class="font-bold text-blue-600">${msg.user}</span>: ${msg.text}`;
            if (flowEnabled) {
                flowComment(msg.text, msg.user, "normal");
            }
        }
    }
    
    chatHistory.prepend(div);
}

function flowComment(text, user, type = "normal") {
    const container = document.getElementById('flowing-comments-layer');
    const el = document.createElement('div');
    
    // クラス分け
    if (type === "system") {
        el.className = "flowing-comment system";
        el.textContent = text;
    } else if (type === "correct") {
        el.className = "flowing-comment correct";
        el.textContent = `${user}: ${text}`;
    } else {
        el.className = "flowing-comment";
        el.textContent = `${user}: ${text}`;
    }
    
    const top = Math.random() * 80; // 0-80%
    el.style.top = `${top}%`;
    
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
}

// -------------------------------------------------------
// 6. ランキング機能
// -------------------------------------------------------
function showRanking() {
    if (!currentRoomData) return;
    const modal = document.getElementById('ranking-modal');
    const list = document.getElementById('ranking-list');
    
    const sortedPlayers = [...currentRoomData.players].sort((a, b) => b.score - a.score);

    list.innerHTML = '';
    sortedPlayers.forEach((p, index) => {
        const isMe = p.uid === currentUser.uid;
        const row = document.createElement('div');
        let rankColor = "text-gray-600";
        let icon = "";
        if (index === 0) { rankColor = "text-yellow-500"; icon = '<i class="fas fa-crown"></i>'; }
        else if (index === 1) { rankColor = "text-gray-400"; }
        else if (index === 2) { rankColor = "text-orange-400"; }

        row.className = `flex justify-between items-center p-3 rounded border-b border-gray-100 ${isMe ? 'bg-blue-50 border-l-4 border-l-blue-400' : 'bg-white'}`;
        row.innerHTML = `
            <div class="flex items-center space-x-3">
                <span class="font-bold text-lg w-8 text-center ${rankColor}">${index + 1}</span>
                <div>
                    <div class="font-bold text-gray-800 ${isMe ? 'text-blue-700' : ''}">
                        ${icon} ${p.name} ${isMe ? '(あなた)' : ''}
                    </div>
                    <div class="text-xs text-gray-400">${p.isOnline ? 'オンライン' : 'オフライン'}</div>
                </div>
            </div>
            <div class="font-mono font-bold text-xl text-blue-600">${p.score}pt</div>
        `;
        list.appendChild(row);
    });

    modal.classList.remove('hidden');
}

// -------------------------------------------------------
// 7. キャンバス機能
// -------------------------------------------------------
function setupCanvas() {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
    });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        draw({ clientX: touch.clientX, clientY: touch.clientY });
    });
    canvas.addEventListener('touchend', stopDrawing);
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    if (!currentRoomData) return;
    if (currentRoomData.currentDrawerUid !== currentUser.uid) return;

    isDrawing = true;
    lastPoint = getPos(e);
    strokeBuffer = [lastPoint]; 
    if (!sendTimer) {
        sendTimer = setInterval(sendStrokeBuffer, 100);
    }
}

function draw(e) {
    if (!isDrawing) return;
    const newPoint = getPos(e);
    drawSegment(lastPoint, newPoint, isEraser ? '#ffffff' : drawingColor, isEraser ? drawingSize * 2 : drawingSize);
    strokeBuffer.push(newPoint);
    lastPoint = newPoint;
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    sendStrokeBuffer();
    if (sendTimer) {
        clearInterval(sendTimer);
        sendTimer = null;
    }
}

async function sendStrokeBuffer() {
    if (strokeBuffer.length < 2) return;
    if (!currentRoomId) return;

    const pointsToSend = [...strokeBuffer];
    strokeBuffer = [strokeBuffer[strokeBuffer.length - 1]]; 

    const strokeData = {
        color: isEraser ? '#ffffff' : drawingColor,
        size: isEraser ? drawingSize * 2 : drawingSize,
        points: pointsToSend
    };

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomRef, {
        canvasData: arrayUnion(strokeData)
    }).catch(err => console.error("Draw sync error", err));
}

async function clearCanvasRemotely() {
    if (!currentRoomId) return;
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomRef, { canvasData: [] });
}

function redrawCanvas(canvasData) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!canvasData) return;

    canvasData.forEach(stroke => {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;

        if (stroke.points.length > 0) {
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
        }
        ctx.stroke();
    });
}

function drawSegment(start, end, color, size) {
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
}

// -------------------------------------------------------
// 8. その他ユーティリティ
// -------------------------------------------------------
function showImageModal(cardName, type = 'check') {
    if (!cardName || cardName === "???") return;
    const modal = document.getElementById('image-modal');
    const titleEl = document.getElementById('modal-title');
    const wordEl = document.getElementById('modal-word');
    const imgEl = document.getElementById('modal-image');

    // タイトルの設定
    if (type === 'start') {
        titleEl.textContent = "お題は";
    } else if (type === 'result') {
        titleEl.textContent = "正解は";
    } else {
        titleEl.textContent = "お題確認";
    }

    // お題と画像のセット
    wordEl.textContent = cardName;
    imgEl.src = IMAGE_BASE_URL + encodeURIComponent(cardName) + ".png";
    imgEl.onerror = () => { imgEl.src = "https://via.placeholder.com/400x600?text=No+Image"; };
    
    // 表示
    modal.classList.remove('hidden');
}

window.onload = init;