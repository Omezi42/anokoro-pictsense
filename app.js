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
    increment // ★修正: increment をインポート
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// -------------------------------------------------------------------
// ▼▼▼ Firebase プロジェクト設定 ▼▼▼
// -------------------------------------------------------------------
// Github Pages で動作させるため、ここに Firebase プロジェクトの
// 「ウェブアプリ」の構成オブジェクトを貼り付けてください。
const firebaseConfig = {
  apiKey: "AIzaSyAbb-B4IaknBvhJDs1Nw2RymsLSqTQSyn8",
  authDomain: "anokoro-pictsense.firebaseapp.com",
  projectId: "anokoro-pictsense",
  storageBucket: "anokoro-pictsense.firebasestorage.app",
  messagingSenderId: "769791445375",
  appId: "1:769791445375:web:76047b7ec3871dbe27f24a"
};
// -------------------------------------------------------------------
// ▲▲▲ Firebase プロジェクト設定 ▲▲▲
// -------------------------------------------------------------------


// Firebase の初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// const analytics = getAnalytics(app);

// グローバル変数
let currentUser = null;
let currentRoomId = null;
let roomUnsubscribe = null; // ルーム監視の解除用
let roomData = null; // 現在のルームデータ
let dictionary = []; // お題辞書
let dictionaryFetched = false;
let isDrawer = false; // 現在のユーザーが出題者かどうか
// ★修正: メッセージ差分検知をSetに変更
let flowingCommentIds = new Set(); // 流れるコメントの重複防止

// キャンバス関連の変数
let canvas, ctx;
let isDrawing = false;
let lastX = 0, lastY = 0;
let currentColor = '#000000';
let currentLineWidth = 5;
let strokeBuffer = []; // 描画データバッファ
let bufferTimer = null; // バッファ送信タイマー

// DOM要素のキャッシュ
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

// モーダル関連
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

// カスタムルール チェックボックス
const rulesCheckboxes = {
    dictionarySearch: document.getElementById('rule-dictionary-search'),
    showImageBefore: document.getElementById('rule-show-image-before'),
    showImageAfter: document.getElementById('rule-show-image-after'),
    flowingComments: document.getElementById('rule-flowing-comments'),
    wordHint: document.getElementById('rule-word-hint'),
};


// -------------------------------------------------------------------
// 初期化処理
// -------------------------------------------------------------------

window.onload = () => {
    // Firebase 匿名認証
    signInAnonymously(auth).catch((error) => {
        console.error("匿名認証に失敗しました:", error);
        alert("認証に失敗しました。ページをリロードしてください。");
    });

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("匿名認証成功:", user.uid);
            // ローディングモーダルを非表示
            loadingModal.classList.add('hidden');
        } else {
            console.log("ユーザーがサインアウトしました。");
            // 認証が必要な場合はロビーを表示し続ける
            loadingModal.classList.add('hidden');
        }
    });

    // キャンバスのセットアップ
    setupCanvas();

    // イベントリスナーの設定
    setupEventListeners();
};

/**
 * キャンバスの初期設定
 */
function setupCanvas() {
    canvas = document.getElementById('drawing-canvas');
    if (!canvas) {
        console.error("キャンバス要素が見つかりません。");
        return;
    }
    ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

/**
 * すべてのイベントリスナーを設定
 */
function setupEventListeners() {
    // ロビー
    joinForm.addEventListener('submit', handleJoinRoom);

    // ゲーム画面
    leaveRoomBtn.addEventListener('click', handleLeaveRoom);
    gameStartBtn.addEventListener('click', handleGameStart);
    answerForm.addEventListener('submit', handleAnswerSubmit);

    // 描画ツールバー
    colorPicker.addEventListener('input', (e) => setCurrentColor(e.target.value));
    quickColorPalette.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.color) {
            setCurrentColor(e.target.dataset.color);
        }
    });
    eraserBtn.addEventListener('click', () => setCurrentColor('#FFFFFF')); // 消しゴムは白
    lineWidthSlider.addEventListener('input', (e) => {
        currentLineWidth = e.target.value;
        lineWidthDisplay.textContent = currentLineWidth;
    });
    clearCanvasBtn.addEventListener('click', handleClearCanvas);
    passBtn.addEventListener('click', handlePass);
    checkWordBtn.addEventListener('click', handleCheckWord); 

    // キャンバス描画イベント (PC + モバイル)
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

    // 辞書検索
    dictionarySearchInput.addEventListener('input', handleDictionarySearch);
    dictionarySearchResults.addEventListener('click', (e) => {
        if (e.target.tagName === 'DIV' && e.target.dataset.word) {
            answerInput.value = e.target.dataset.word;
            dictionarySearchResults.innerHTML = '';
            dictionarySearchInput.value = '';
        }
    });

    // モーダル
    showImageCloseBtn.addEventListener('click', () => {
        showImageModal.classList.add('hidden');
    });

    // ★修正: 辞書を最初に読み込む
    fetchDictionary();
}

// -------------------------------------------------------------------
// ロビーとルーム管理
// -------------------------------------------------------------------

/**
 * ルーム入室処理
 * @param {Event} e フォーム送信イベント
 */
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
            isOnline: true
        };

        if (roomDoc.exists()) {
            // ルームが存在する
            const existingData = roomDoc.data();
            const onlinePlayers = Object.values(existingData.players || {}).filter(p => p.isOnline);

            if (onlinePlayers.length === 0) {
                // オンラインが0人ならリセット
                console.log("オンラインのプレイヤーがいないため、ルームをリセットします。");
                await resetRoom(roomDocRef, myPlayerData, username);
            } else {
                // 誰かいるなら参加
                await updateDoc(roomDocRef, {
                    [`players.${currentUser.uid}`]: myPlayerData
                });
            }
        } else {
            // ルームが存在しない (新規作成)
            console.log("新しいルームを作成します。");
            await resetRoom(roomDocRef, myPlayerData, username);
        }

        // ★修正: 重複防止Setをクリア
        flowingCommentIds.clear();
        
        // ルームの監視を開始
        setupRoomListener(roomDocRef);

        // UI切り替え
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        roomIdDisplay.textContent = currentRoomId;
        loadingModal.classList.add('hidden');

        // ★削除: 辞書読み込み (最初に移動)
        // fetchDictionary();

    } catch (error) {
        console.error("ルームへの参加に失敗しました:", error);
        alert("ルームへの参加に失敗しました。");
        loadingModal.classList.add('hidden');
        currentRoomId = null;
    }
}

/**
 * ルームをリセット（または新規作成）する
 * @param {DocumentReference} roomDocRef 
 * @param {object} myPlayerData 
 * @param {string} username
 */
async function resetRoom(roomDocRef, myPlayerData, username) {
    // カスタムルールを取得
    const customRules = {};
    for (const key in rulesCheckboxes) {
        customRules[key] = rulesCheckboxes[key].checked;
    }

    const newRoomData = {
        gameState: "waiting", // "waiting", "drawing", "result"
        currentWord: "",
        normalizedWord: "",
        currentDrawerId: currentUser.uid, // 最初の参加者が出題者
        drawingData: [], // 描画ストロークデータ
        messages: [], // チャットログ
        players: {
            [currentUser.uid]: myPlayerData
        },
        customRules: customRules, // カスタムルール
        turnStartTime: null, // ターン開始時間
        lastWinner: null, // 直近の勝者情報
        pointsAwarded: 0 // 直近の獲得ポイント
    };

    // setDoc でルームデータを上書き
    await setDoc(roomDocRef, newRoomData);
}

/**
 * ルームデータの変更を監視
 * @param {DocumentReference} roomDocRef 
 */
function setupRoomListener(roomDocRef) {
    if (roomUnsubscribe) {
        roomUnsubscribe(); // 既存の監視を解除
    }

    roomUnsubscribe = onSnapshot(roomDocRef, (doc) => {
        if (!doc.exists()) {
            console.log("ルームが削除されました。");
            handleLeaveRoom(true); // 強制退室
            return;
        }

        const oldGameState = roomData ? roomData.gameState : null;
        roomData = doc.data();
        isDrawer = roomData.currentDrawerId === currentUser.uid;

        console.log("ルームデータ更新:", roomData);

        // データの更新処理
        updateScoreboard();
        updateMessages(); 
        handleNewMessagesFlow(roomData.messages || []); // ★修正: 流れるコメントの処理
        updateUIForGameState(oldGameState);
        redrawCanvas();

    }, (error) => {
        console.error("ルームの監視に失敗しました:", error);
        alert("ルームとの接続が切れました。");
        handleLeaveRoom(false);
    });
}

/**
 * 退室処理
 * @param {boolean} [silent=false] 警告なしで退室するか
 */
async function handleLeaveRoom(silent = false) {
    if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
    }

    if (currentRoomId && currentUser) {
        const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
        try {
            // 自分のオンライン状態を false に
            await updateDoc(roomDocRef, {
                [`players.${currentUser.uid}.isOnline`]: false
            });
            console.log("退室しました。");
        } catch (error) {
            console.error("退室処理に失敗しました:", error);
        }
    }

    // UIをロビーに戻す
    gameScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    
    // 状態リセット
    currentRoomId = null;
    roomData = null;
    isDrawer = false;

    if (!silent) {
        // alert("退室しました。");
    }
}

// -------------------------------------------------------------------
// UI更新
// -------------------------------------------------------------------

/**
 * スコアボードを更新
 */
function updateScoreboard() {
    if (!roomData || !roomData.players) return;

    const players = Object.entries(roomData.players)
        .filter(([, playerData]) => playerData.isOnline) // オンラインのプレイヤーのみ
        .sort(([, a], [, b]) => b.score - a.score); // スコア順

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

/**
 * チャット・回答ログを更新
 */
function updateMessages() {
    if (!roomData || !roomData.messages) return;

    messagesContainer.innerHTML = '';
    roomData.messages.forEach(msg => {
        appendMessage(msg);
    });
    // スクロールを一番下に
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * メッセージをDOMに追加
 * @param {object} msg { type, username, text, (color) }
 */
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

    // スクロールを一番下に
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * ★修正: 新しいメッセージを検知してコメントを流す (重複防止)
 * @param {Array} messages 
 */
function handleNewMessagesFlow(messages) {
    if (!roomData || !roomData.customRules.flowingComments) return;

    messages.forEach(msg => {
        if (!msg.timestamp) return; // timestamp がないデータは無視

        // 簡易ユニークID (ミリ秒 + テキスト内容)
        const msgId = msg.timestamp.toMillis() + (msg.text || ''); 
        
        if (!flowingCommentIds.has(msgId)) {
            createFlowingComment(msg);
            flowingCommentIds.add(msgId);
        }
    });
}


/**
 * ゲームの状態でUIを更新
 * @param {string} oldGameState 前のゲーム状態
 */
function updateUIForGameState(oldGameState) {
    if (!roomData) return;

    const state = roomData.gameState;
    
    // 辞書検索（カスタムルール）
    dictionarySearchContainer.classList.toggle('hidden', !roomData.customRules.dictionarySearch || isDrawer);

    if (state === 'waiting') {
        currentWordDisplay.textContent = '待機中...';
        drawingToolbar.classList.add('hidden');
        answerInput.placeholder = 'チャットを入力...';
        answerInput.disabled = false;
        resultModal.classList.add('hidden');
        
        // ★修正: 最初の1ターン目（messagesが空）の出題者のみ「ゲーム開始」ボタン表示
        const isFirstTurnEver = roomData.messages.length === 0;
        gameStartBtn.classList.toggle('hidden', !isDrawer || !isFirstTurnEver);

        // ★修正: 結果画面から待機画面に移行し、かつ自分が出題者になった場合、自動で次ターン開始
        if (oldGameState === 'result' && isDrawer) {
            console.log("自動で次のターンを開始します。");
            startNewTurn(); // 自動で次ターン開始
        }

    } else if (state === 'drawing') {
        gameStartBtn.classList.add('hidden'); // ★修正: ゲームが始まったら必ず隠す
        resultModal.classList.add('hidden');
        
        // お題表示
        if (isDrawer) {
            currentWordDisplay.textContent = roomData.currentWord || 'お題取得中...';
            drawingToolbar.classList.remove('hidden');
            answerInput.placeholder = '（出題者は回答できません）';
            answerInput.disabled = true;
        } else {
            // 回答者のお題表示
            if (roomData.customRules.wordHint && roomData.currentWord) {
                currentWordDisplay.textContent = '〇'.repeat(roomData.currentWord.length);
            } else {
                currentWordDisplay.textContent = 'お題は...';
            }
            drawingToolbar.classList.add('hidden');
            answerInput.placeholder = '回答を入力...';
            answerInput.disabled = false;
        }

        // ターン開始時にお題イラスト表示（カスタムルール）
        if (oldGameState !== 'drawing' && isDrawer && roomData.customRules.showImageBefore) {
            showImageModalFunc(roomData.currentWord);
        }

    } else if (state === 'result') {
        currentWordDisplay.textContent = `正解: ${roomData.currentWord}`;
        drawingToolbar.classList.add('hidden');
        answerInput.placeholder = 'チャットを入力...';
        answerInput.disabled = false;
        
        // 結果モーダル表示 (前の状態が result でない場合のみ)
        if (oldGameState !== 'result') {
            showResultModal();
            
            // 5秒後に自動で次ターンへ (出題者のみがトリガー)
            if (isDrawer) {
                setTimeout(startNextTurn, 5000);
            }
        }
    }
}

/**
 * 結果モーダルを表示
 */
function showResultModal() {
    if (!roomData || !roomData.lastWinner) return;
    
    resultWinner.textContent = `${roomData.lastWinner.username} さんが正解しました！`;
    resultWord.textContent = `お題: ${roomData.currentWord}`;
    resultPoints.textContent = `出題者と正解者に +${roomData.pointsAwarded} ポイント！`;
    
    // 結果時イラスト表示（カスタムルール）
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

/**
 * お題イラスト確認モーダルを表示 (出題者用)
 * @param {string} word 
 */
function showImageModalFunc(word) {
    if (!word) return;
    const imageUrl = getCardImageUrl(word);
    showImageWord.textContent = word;
    showImageImg.src = imageUrl;
    showImageImg.onerror = () => { showImageImg.src = 'https://placehold.co/300x420/eee/ccc?text=No+Image'; };
    showImageModal.classList.remove('hidden');
}

/**
 * 流れるコメントを作成
 * @param {object} msg { type, username, text }
 */
function createFlowingComment(msg) {
    // if (!roomData || !roomData.customRules.flowingComments) return; // 呼び出し元でチェック済
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

    // Y座標をランダムに
    item.style.top = `${Math.floor(Math.random() * 70) + 5}%`; // 5% から 75% の間

    commentFlowContainer.appendChild(item);

    // アニメーション終了後に削除
    item.addEventListener('animationend', () => {
        item.remove();
    });
}


// -------------------------------------------------------------------
// ゲーム進行ロジック
// -------------------------------------------------------------------

/**
 * お題辞書をGithubから取得
 */
async function fetchDictionary() {
    if (dictionaryFetched) return;
    
    // ★修正: 実行中フラグ（簡易）
    dictionaryFetched = true; // 試行中フラグ

    const url = 'https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/all_card_names.txt';
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('辞書の読み込みに失敗しました。');
        const text = await response.text();
        dictionary = text.split('\n').filter(Boolean); // 空行を除外
        console.log(`辞書を読み込みました: ${dictionary.length} 件`);
    } catch (error) {
        dictionaryFetched = false; // ★修正: 失敗したら再試行できるように
        console.error(error);
        alert("お題辞書の読み込みに失敗しました。");
    }
}

/**
 * 「ゲーム開始」ボタン（最初のターン）
 */
async function handleGameStart() {
    if (!isDrawer) return;
    await startNewTurn();
}

/**
 * 新しいお題でターンを開始
 */
async function startNewTurn() {
    if (!isDrawer) return;
    if (!dictionaryFetched) { // ★修正: 辞書がまだなら再試行
        await fetchDictionary(); 
    }
    if (dictionary.length === 0) {
        alert("辞書が空か、読み込みに失敗しました。");
        return;
    }

    // 新しいお題をランダムに選択
    const newWord = dictionary[Math.floor(Math.random() * dictionary.length)];
    const normalizedWord = normalizeText(newWord);

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    
    try {
        await updateDoc(roomDocRef, {
            gameState: "drawing",
            currentWord: newWord,
            normalizedWord: normalizedWord,
            drawingData: [], // キャンバスリセット
            turnStartTime: Timestamp.now(), // ターン開始時間
            messages: arrayUnion({ // システムメッセージ
                type: "system",
                text: `${roomData.players[currentUser.uid].username} が描いています。`,
                timestamp: Timestamp.now()
            })
        });
    } catch (error) {
        console.error("ターン開始に失敗:", error);
    }
}

/**
 * 5秒後に次のターンを開始 (result状態から)
 */
async function startNextTurn() {
    if (!isDrawer || roomData.gameState !== 'result') return;

    // 次の出題者を決める
    const nextDrawerId = findNextDrawer();
    
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        // ★修正: 次の出題者をセットし、待機状態に戻す。
        // この時、次のターンに不要なデータをリセットする。
        await updateDoc(roomDocRef, {
            currentDrawerId: nextDrawerId,
            gameState: "waiting", // 一瞬 waiting に戻す
            currentWord: "",
            normalizedWord: "",
            drawingData: [],
            turnStartTime: null,
            lastWinner: null,
            pointsAwarded: 0
        });

        // ログ
        console.log(`次の出題者: ${nextDrawerId}`);
        
        // ★修正: 自動開始のロジックは onSnapshot -> updateUIForGameState が担当する

    } catch (error) {
        console.error("次のターンの準備に失敗:", error);
    }
}

/**
 * 次の出題者IDを見つける
 */
function findNextDrawer() {
    const onlinePlayers = Object.entries(roomData.players)
        .filter(([, p]) => p.isOnline)
        .map(([uid]) => uid); // オンラインのUIDリスト
    
    if (onlinePlayers.length === 0) {
        return currentUser.uid; // 万が一の場合
    }
    
    // 現在の出題者がオンラインリストにいない場合（ありえないが）、最初の人にする
    const currentIndex = onlinePlayers.indexOf(roomData.currentDrawerId);
    if (currentIndex === -1) {
        return onlinePlayers[0];
    }

    const nextIndex = (currentIndex + 1) % onlinePlayers.length;
    
    return onlinePlayers[nextIndex];
}

/**
 * 「パス」ボタン処理
 */
async function handlePass() {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    
    // システムメッセージを追加
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomDocRef, {
        messages: arrayUnion({
            type: "pass",
            username: roomData.players[currentUser.uid].username,
            text: "出題者がパスしました。お題を変更します。",
            timestamp: Timestamp.now()
        })
    });

    // 新しいお題でターンを再開（ペナルティなし）
    await startNewTurn();
}

/**
 * 「全消し」ボタン処理
 */
async function handleClearCanvas() {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    
    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    await updateDoc(roomDocRef, {
        drawingData: [] // 描画データリセット
    });
}


// -------------------------------------------------------------------
// 回答とチャット
// -------------------------------------------------------------------

/**
 * 回答・チャット送信処理
 * @param {Event} e 
 */
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
    
    // ゲーム中かつ回答者の場合
    if (roomData.gameState === 'drawing' && !isDrawer) {
        const normalizedAnswer = normalizeText(text);
        
        // ★削除: 流れるコメント (onSnapshotで処理)

        if (normalizedAnswer === roomData.normalizedWord) {
            // ----- 正解！ -----
            await handleCorrectAnswer(messageData);
            answerInput.value = ''; // 入力欄をクリア
            return;
        } else {
            // 不正解
            messageData.type = "answer";
        }
    } else {
        // チャット
        messageData.type = "chat";
        // ★削除: 流れるコメント (onSnapshotで処理)
    }

    // メッセージをFirestoreに追加 (正解時以外)
    try {
        await updateDoc(roomDocRef, {
            messages: arrayUnion(messageData)
        });
        answerInput.value = ''; // 入力欄をクリア
    } catch (error) {
        console.error("メッセージの送信に失敗:", error);
    }
}

/**
 * 正解処理
 * @param {object} correctMessage 
 */
async function handleCorrectAnswer(correctMessage) {
    // ★修正: 競合防止のガード節
    if (roomData.gameState !== 'drawing') {
        console.log("競合: すでに正解処理が実行されています。");
        return;
    }

    // 経過秒数
    const elapsedSeconds = Timestamp.now().seconds - roomData.turnStartTime.seconds;
    // ★修正: ポイント減衰を緩和 (最低20点、100点から2秒毎に1点減)
    const points = Math.max(20, 100 - Math.floor(elapsedSeconds / 2));

    const winnerId = correctMessage.userId;
    const drawerId = roomData.currentDrawerId;

    // ★削除: スコアのローカル読み取りは不要
    // const winnerScore = roomData.players[winnerId]?.score || 0;
    // const drawerScore = roomData.players[drawerId]?.score || 0;

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    
    // 正解メッセージ
    const systemCorrectMessage = {
        type: "correct",
        username: correctMessage.username,
        text: `${correctMessage.username} が正解しました！`, // textはappendMessageで上書きされる
        timestamp: Timestamp.now()
    };

    try {
        // バッチ処理で更新
        const batch = writeBatch(db);
        
        batch.update(roomDocRef, {
            gameState: "result",
            lastWinner: {
                userId: winnerId,
                username: correctMessage.username
            },
            pointsAwarded: points,
            
            // ★修正: スコアを加算 (increment を使用)
            [`players.${winnerId}.score`]: increment(points),
            [`players.${drawerId}.score`]: increment(points),

            // 正解メッセージを追加 (チャットログにも残す)
            messages: arrayUnion(correctMessage, systemCorrectMessage)
        });

        await batch.commit();

        // ★削除: 流れるコメント (onSnapshotに任せる)
        // createFlowingComment(systemCorrectMessage);

    } catch (error) {
        console.error("正解処理に失敗:", error);
    }
}

/**
 * 辞書検索ハンドラ
 */
function handleDictionarySearch() {
    if (!dictionaryFetched || dictionary.length === 0) return;
    
    const query = normalizeText(dictionarySearchInput.value.trim());
    if (query.length < 1) {
        dictionarySearchResults.innerHTML = '';
        return;
    }

    const results = dictionary.filter(word => {
        return normalizeText(word).includes(query);
    }).slice(0, 10); // 最大10件

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

// -------------------------------------------------------------------
// 描画ロジック (Canvas & Firestore)
// -------------------------------------------------------------------

/**
 * 描画開始 (mousedown / touchstart)
 * @param {Event} e 
 */
function startDrawing(e) {
    if (!isDrawer || roomData.gameState !== 'drawing') return;
    isDrawing = true;

    const { x, y } = getMousePos(e);
    lastX = x;
    lastY = y;

    // バッファに 'start' イベントを追加
    strokeBuffer.push({
        type: 'start',
        x: x,
        y: y,
        color: currentColor,
        width: currentLineWidth
    });

    // 1点描画（クリック）
    drawOnCanvas({ type: 'start', x: x, y: y, color: currentColor, width: currentLineWidth });
    drawOnCanvas({ type: 'draw', x: x, y: y });
}

/**
 * 描画中 (mousemove / touchmove)
 * @param {Event} e 
 */
function draw(e) {
    if (!isDrawing) return;

    const { x, y } = getMousePos(e);
    
    // バッファに 'draw' イベントを追加
    strokeBuffer.push({
        type: 'draw',
        x: x,
        y: y
    });

    // 即時描画 (ローカルのキャンバスにも描く)
    drawOnCanvas({ type: 'start', x: lastX, y: lastY, color: currentColor, width: currentLineWidth });
    drawOnCanvas({ type: 'draw', x: x, y: y });

    lastX = x;
    lastY = y;

    // バッファ送信タイマー
    if (!bufferTimer) {
        bufferTimer = setTimeout(sendBuffer, 100); // 100msごとに送信
    }
}

/**
 * 描画終了 (mouseup / mouseout / touchend)
 */
function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    
    // バッファに残っているデータを強制送信
    if (bufferTimer) {
        clearTimeout(bufferTimer);
        bufferTimer = null;
    }
    sendBuffer();
}

/**
 * マウス/タッチ座標をキャンバス座標に変換
 * @param {Event} e 
 * @returns {object} {x, y}
 */
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

/**
 * 描画データをFirestoreに送信
 */
async function sendBuffer() {
    if (bufferTimer) {
        clearTimeout(bufferTimer);
        bufferTimer = null;
    }

    if (strokeBuffer.length === 0 || !currentRoomId) return;

    const bufferToSend = [...strokeBuffer]; // コピー
    strokeBuffer = []; // バッファクリア

    const roomDocRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        // arrayUnion でデータを追加
        await updateDoc(roomDocRef, {
            drawingData: arrayUnion(...bufferToSend)
        });
    } catch (error) {
        console.error("描画データの送信に失敗:", error);
        // 送信失敗したデータをバッファに戻す（次回に期待）
        strokeBuffer = [...bufferToSend, ...strokeBuffer];
    }
}

/**
 * Firestoreのデータからキャンバス全体を再描画
 */
function redrawCanvas() {
    if (!ctx || !roomData || !roomData.drawingData) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 描画データを最初から再生
    roomData.drawingData.forEach(stroke => {
        drawOnCanvas(stroke);
    });
}

/**
 * 1ストローク分のデータをキャンバスに描画
 * @param {object} stroke 
 */
function drawOnCanvas(stroke) {
    if (!ctx) return;
    
    if (stroke.type === 'start') {
        ctx.beginPath();
        ctx.moveTo(stroke.x, stroke.y);
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        // 1点描画用
        ctx.lineTo(stroke.x, stroke.y);
        ctx.stroke();
    } else if (stroke.type === 'draw') {
        ctx.lineTo(stroke.x, stroke.y);
        ctx.stroke();
    }
    // 'end' は使わない (beginPathで自動的に切れる)
}

/**
 * 描画色を設定 (ツールバーの選択状態も更新)
 * @param {string} color 
 */
function setCurrentColor(color) {
    currentColor = color;
    colorPicker.value = color; // ピッカーの色も同期

    // クイックパレットの選択状態
    quickColorPalette.querySelectorAll('.quick-color').forEach(btn => {
        btn.classList.toggle('border-gray-400', btn.dataset.color === color);
        btn.classList.toggle('border-2', btn.dataset.color === color);
    });
}


// -------------------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------------------

/**
 * 「お題確認」ボタン処理
 */
function handleCheckWord() {
    if (!isDrawer || !roomData || !roomData.currentWord) return;
    
    // 既存のイラスト表示モーダルを流用
    showImageModalFunc(roomData.currentWord);
}

/**
 * 回答比較用のテキスト正規化 (ひらがな化、カタカナ化、空白削除)
 * @param {string} text 
 * @returns {string}
 */
function normalizeText(text) {
    if (!text) return "";
    return text
        .trim()
        .toLowerCase()
        // カタカナをひらがなに
        .replace(/[\u30a1-\u30f6]/g, (match) => {
            return String.fromCharCode(match.charCodeAt(0) - 0x60);
        })
        // 長音符「ー」を「あ」行の直前の文字に変換（例：「ヒーロー」→「ひいろお」）
        // .replace(/ー/g, (match, offset, str) => {
        //     const prevChar = str[offset - 1];
        //     if (!prevChar) return '';
        //     const vowels = {
        //         'あ': 'あ', 'か': 'あ', 'さ': 'あ', 'た': 'あ', 'な': 'あ', 'は': 'あ', 'ま': 'あ', 'や': 'あ', 'ら': 'あ', 'わ': 'あ',
        //         'い': 'い', 'き': 'い', 'し': 'い', 'ち': 'い', 'に': 'い', 'ひ': 'い', 'み': 'い', 'り': 'い',
        //         'う': 'う', 'く': 'う', 'す': 'う', 'つ': 'う', 'ぬ': 'う', 'ふ': 'う', 'む': 'う', 'ゆ': 'う', 'る': 'う',
        //         'え': 'え', 'け': 'え', 'せ': 'え', 'て': 'え', 'ね': 'え', 'へ': 'え', 'め': 'え', 'れ': 'え',
        //         'お': 'お', 'こ': 'お', 'そ': 'お', 'と': 'お', 'の': 'お', 'ほ': 'お', 'も': 'お', 'よ': 'お', 'ろ': 'お', 'を': 'お'
        //     };
        //     // ... (濁音・半濁音の処理が必要で複雑)
        //     // -> シンプルに「ー」は削除する、またはひらがなの「ー」にする
        //     return 'ー'; 
        // })
        // 記号と空白を削除
        .replace(/[\s\u3000!-/:-@[-`{-~、。ー]/g, ''); // 空白、記号、長音符「ー」も削除
}

/**
 * カード画像のURLを取得
 * @param {string} cardName
 * @returns {string}
 */
function getCardImageUrl(cardName) {
    if (!cardName) return '';
    // カード名（お題）をエンコードする
    // スペースや特殊文字が含まれる可能性があるため
    const encodedName = encodeURIComponent(cardName);
    return `https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/images/captured_cards/${encodedName}.png`;
}