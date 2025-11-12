// Firebase SDK (ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInAnonymously, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    onSnapshot, 
    arrayUnion,
    Timestamp,
    increment,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ----------------------------------------------------------------
// Firebaseプロジェクトの設定
// ----------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAbb-B4IaknBvhJDs1Nw2RymsLSqTQSyn8",
  authDomain: "anokoro-pictsense.firebaseapp.com",
  projectId: "anokoro-pictsense",
  storageBucket: "anokoro-pictsense.firebasestorage.app",
  messagingSenderId: "769791445375",
  appId: "1:769791445375:web:76047b7ec3871dbe27f24a"
};
// ----------------------------------------------------------------

// Firebaseの初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// グローバル変数
let currentUserId = null;
let currentUsername = null;
let currentRoomId = null;
let roomUnsubscribe = null; // ルーム監視解除用の関数
let roomData = null; // 現在のルームデータを保持
let dictionary = []; // お題辞書
let drawingBuffer = []; // 描画データ送信用バッファ
let sendBufferInterval = null; // バッファ送信タイマー
let isDrawing = false;
let lastDrawPoint = { x: 0, y: 0 };
let currentTool = 'pen';
let currentColor = '#000000';
let currentLineWidth = 5;
let turnTimeout = null; // 次ターンへの自動移行タイマー

// DOM要素
const loadingOverlay = document.getElementById('loading-overlay');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const joinRoomForm = document.getElementById('join-room-form');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const joinRoomButton = document.getElementById('join-room-button');

// ゲーム画面の要素
const leaveRoomButton = document.getElementById('leave-room-button');
const startGameButton = document.getElementById('start-game-button');
const gameStateDisplay = document.getElementById('game-state-display');
const wordHintContainer = document.getElementById('word-hint-container');
const wordHint = document.getElementById('word-hint');
const wordHintText = document.getElementById('word-hint-text');
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('drawing-canvas');
const ctx = canvas.getContext('2d');
const commentFlowOverlay = document.getElementById('comment-flow-overlay');
const toolbar = document.getElementById('toolbar');
const penTool = document.getElementById('pen-tool');
const eraserTool = document.getElementById('eraser-tool');
const colorPicker = document.getElementById('color-picker');
const lineWidthSlider = document.getElementById('line-width-slider');
const lineWidthDisplay = document.getElementById('line-width-display');
const passButton = document.getElementById('pass-button');
const clearCanvasButton = document.getElementById('clear-canvas-button');
const playerList = document.getElementById('player-list');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const dictionarySearchContainer = document.getElementById('dictionary-search-container');
const dictionarySearchInput = document.getElementById('dictionary-search-input');
const dictionarySearchResults = document.getElementById('dictionary-search-results');
const checkWordButton = document.getElementById('check-word-button'); // ★ 追加

// モーダル要素
const illustModal = document.getElementById('illust-modal');
const illustModalTitle = document.getElementById('illust-modal-title');
const illustModalImage = document.getElementById('illust-modal-image');
const illustModalWord = document.getElementById('illust-modal-word');
const closeIllustModalButton = document.getElementById('close-illust-modal-button');

// ----- ユーティリティ関数 -----

/**
 * カタカナをひらがなに変換する
 */
const katakanaToHiragana = (str) => {
    return str.replace(/[\u30a1-\u30f6]/g, (match) => {
        return String.fromCharCode(match.charCodeAt(0) - 0x60);
    });
};

/**
 * 回答を正規化する (ひらがな化、空白削除、英数小文字化)
 */
const normalizeAnswer = (text) => {
    if (!text) return "";
    let normalized = text.trim().toLowerCase(); // 英数を小文字に
    normalized = katakanaToHiragana(normalized);
    normalized = normalized.replace(/\s+/g, ''); // 全角・半角空白を削除
    // 長音符「ー」の処理は複雑なため省略
    return normalized;
};

/**
 * 辞書を読み込む
 */
async function fetchDictionary() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/all_card_names.txt');
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        dictionary = text.split('\n').filter(Boolean).map(name => name.trim());
        console.log(`辞書を読み込みました: ${dictionary.length}件`);
    } catch (error) {
        console.error("辞書の読み込みに失敗しました:", error);
        addChatMessage("システム", "辞書の読み込みに失敗しました。", "system", false); // ★ flow: false に変更
    }
}

/**
 * カード画像のURLを取得する
 */
const getCardImageUrl = (cardName) => {
    // URLエンコードするが、/ はエンコードしない
    const encodedName = encodeURIComponent(cardName).replace(/%2F/g, "/");
    return `https://raw.githubusercontent.com/Omezi42/AnokoroImageFolder/main/images/captured_cards/${encodedName}.png`;
};

/**
 * チャットメッセージをUIに追加
 */
const addChatMessage = (username, message, type = "log", flowComment = true) => { // ★ flowComment 引数を追加 (デフォルト true)
    const msgEl = document.createElement('div');
    msgEl.classList.add('chat-message', type);
    
    const nameEl = document.createElement('span');
    nameEl.classList.add('font-medium');
    nameEl.textContent = `${username}: `;
    
    const textEl = document.createElement('span');
    textEl.textContent = message;

    if (type === "system" || type === "correct") {
        textEl.textContent = message;
        msgEl.appendChild(textEl);
    } else {
        msgEl.appendChild(nameEl);
        msgEl.appendChild(textEl);
    }
    
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight; // 自動スクロール

    // 流れるコメント (アナウンスも対象にする)
    // ★ flowComment フラグが true の場合のみ実行
    if (flowComment && roomData?.customRules?.commentFlow && (type === 'log' || type === 'correct' || type === 'system')) {
        showFlowingComment(message, username, type);
    }
};

/**
 * 流れるコメントをキャンバス上に表示
 */
function showFlowingComment(text, username, type) {
    const commentEl = document.createElement('div');
    commentEl.className = 'comment-flow-item';
    // 名前を表示 (システムアナウンス以外)
    commentEl.textContent = (type === 'system') ? text : `${username}: ${text}`;
    // ランダムなY位置に配置
    commentEl.style.top = `${Math.random() * 80 + 10}%`; 

    // --- 速度計算ロジック START (画面サイズに依存しないように) ---
    // 画面に一時的に追加して幅を取得
    commentEl.style.visibility = 'hidden';
    document.body.appendChild(commentEl);
    const elementWidth = commentEl.clientWidth;
    document.body.removeChild(commentEl);
    commentEl.style.visibility = 'visible';
    
    // ★ キャンバスコンテナの幅 (800px) を基準にする
    const containerWidth = canvasContainer.clientWidth || 800; // 800px に固定
    const travelDistance = containerWidth + elementWidth;
    
    // 速度 (ピクセル/秒) を設定。
    const speed = 160; // 160px/sec
    
    let duration;
    // 画面幅が0の場合のフォールバック
    if (travelDistance === 0 || speed === 0) {
        duration = 10; // デフォルト10秒
    } else {
        duration = travelDistance / speed;
    }
    // --- 速度計算ロジック END ---

    commentEl.style.animation = `comment-flow ${duration}s linear forwards`;

    commentFlowOverlay.appendChild(commentEl);

    // アニメーション終了後に削除
    commentEl.addEventListener('animationend', () => {
        if (commentFlowOverlay.contains(commentEl)) {
            commentFlowOverlay.removeChild(commentEl);
        }
    });
}


// ----- 認証・ロビー処理 -----

/**
 * ページ読み込み時の処理
 */
window.onload = async () => {
    // ★ キャンバス解像度を固定 (800x450)
    // HTML側で width/height が設定されているため、JSでの設定は不要
    // canvas.width = 800;
    // canvas.height = 450;
    
    await fetchDictionary(); // 辞書を先に読み込む

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUserId = user.uid;
            console.log("匿名認証成功:", currentUserId);
            // 認証が終わったらローディングを非表示にし、ロビーを表示
            loadingOverlay.classList.add('hidden');
            lobbyScreen.classList.remove('hidden');
        } else {
            // 認証失敗または未認証
            try {
                await signInAnonymously(auth);
            } catch (error) {
                console.error("匿名認証に失敗:", error);
                loadingOverlay.textContent = "認証に失敗しました。リロードしてください。";
            }
        }
    });
};

/**
 * ロビーフォームの送信処理
 */
joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    
    if (!username || !roomId || !currentUserId) {
        alert("ユーザー名とルームIDを入力してください。");
        return;
    }
    
    currentUsername = username;
    currentRoomId = roomId;
    
    joinRoomButton.disabled = true;
    joinRoomButton.textContent = "入室中...";

    try {
        await joinRoom(roomId, currentUserId, username);
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        
        // ★ resizeCanvas() の呼び出しは削除 (固定サイズのため)
        // resizeCanvas(); 
        
        // ★ 固定サイズになったので、入室時に一度だけ再描画
        if (roomData) {
            redrawCanvas(roomData.drawingData);
        }

    } catch (error) {
        console.error("入室エラー:", error);
        alert("ルームへの入室に失敗しました。");
        joinRoomButton.disabled = false;
        joinRoomButton.textContent = "入室する";
    }
});

/**
 * ルーム参加処理
 */
async function joinRoom(roomId, userId, username) {
    const roomRef = doc(db, "pictsenseRooms", roomId);
    const roomDoc = await getDoc(roomRef);

    // カスタムルールを取得
    const customRules = {
        search: document.getElementById('rule-search').checked,
        showIllustBefore: document.getElementById('rule-show-illust-before').checked,
        showIllustAfter: document.getElementById('rule-show-illust-after').checked,
        commentFlow: document.getElementById('rule-comment-flow').checked,
        hint: document.getElementById('rule-hint').checked,
    };

    const playerData = {
        username: username,
        score: 0,
        isOnline: true,
    };

    if (!roomDoc.exists()) {
        // --- ルームが存在しない: 新規作成 ---
        console.log(`ルーム ${roomId} が存在しないため新規作成します。`);
        await createNewRoom(roomRef, userId, playerData, customRules);
    } else {
        // --- ルームが存在する: 参加またはリセット ---
        const existingData = roomDoc.data();
        const players = existingData.players || {};
        const onlinePlayers = Object.values(players).filter(p => p.isOnline);

        if (onlinePlayers.length === 0) {
            // --- オンラインの人が誰もいない: ルームをリセットして上書き ---
            console.log(`ルーム ${roomId} に誰もいないためリセットします。`);
            await createNewRoom(roomRef, userId, playerData, customRules);
        } else {
            // --- 誰かいる: 参加 ---
            console.log(`ルーム ${roomId} に参加します。`);
            await updateDoc(roomRef, {
                [`players.${userId}`]: playerData
            });
        }
    }

    // ルームの監視を開始
    startRoomSubscription(roomRef);
}

/**
 * 新規ルーム作成（またはリセット）
 */
async function createNewRoom(roomRef, userId, playerData, customRules) {
    const newRoomData = {
        gameState: "waiting", // 待機中
        players: {
            [userId]: playerData
        },
        customRules: customRules,
        currentDrawerId: userId, // 最初の出題者は作成者
        currentWord: "",
        normalizedWord: "",
        drawingData: [], // 描画データリセット
        messages: [], // チャットログリセット (サブコレクションのほうが望ましいが要件簡略化のため配列)
        turnStartTime: null,
    };
    await setDoc(roomRef, newRoomData);
}

/**
 * 退室処理
 */
leaveRoomButton.addEventListener('click', async () => {
    if (!currentRoomId || !currentUserId || !roomUnsubscribe) return;

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    
    // 監視を停止
    roomUnsubscribe();
    roomUnsubscribe = null;
    roomData = null; // ルームデータクリア

    // 描画バッファも停止
    if (sendBufferInterval) {
        clearInterval(sendBufferInterval);
        sendBufferInterval = null;
    }
    // 次ターンタイマーも停止
    if (turnTimeout) {
        clearTimeout(turnTimeout);
        turnTimeout = null;
    }

    try {
        // オフライン状態を Firestore に書き込む
        await updateDoc(roomRef, {
            [`players.${currentUserId}.isOnline`]: false
        });
        
        // 自分が最後のオンラインプレイヤーだった場合、誰が後処理するか？
        // → 次に参加した人がリセットするので不要

    } catch (error) {
        console.error("退室処理エラー:", error);
    }

    // UIリセット
    gameScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    joinRoomButton.disabled = false;
    joinRoomButton.textContent = "入室する";
    playerList.innerHTML = "";
    chatMessages.innerHTML = "";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    currentRoomId = null;
});

// ----- ルーム監視 (onSnapshot) -----

function startRoomSubscription(roomRef) {
    if (roomUnsubscribe) {
        roomUnsubscribe(); // 既存の監視を解除
    }

    roomUnsubscribe = onSnapshot(roomRef, (doc) => {
        if (!doc.exists()) {
            console.log("ルームが削除されました。");
            // 退室処理と同様のUIリセットを行う
            leaveRoomButton.click(); 
            alert("ルームが削除されました。ロビーに戻ります。");
            return;
        }

        const newData = doc.data();
        const oldData = roomData;
        roomData = newData; // グローバルデータを更新

        // UI更新
        updatePlayerList(newData.players);
        updateGameStateUI(newData);
        updateChat(newData.messages, oldData?.messages);

        // 描画データの更新
        const isDrawer = newData.currentDrawerId === currentUserId; // ★ 自分が描画者か
        
        // ★ 修正: 描画者でない場合のみ、Firestoreのデータで再描画
        // (描画者はローカルでリアルタイム描画するため、onSnapshotでの再描画は不要)
        if (!isDrawer && JSON.stringify(newData.drawingData) !== JSON.stringify(oldData?.drawingData)) {
            redrawCanvas(newData.drawingData);
        }
        
        // ★ 修正: 自分が描画者になった瞬間（ターンが回ってきた時）、キャンバスをクリア
        // (startTurnで drawingData: [] がセットされたのを検知)
        if (isDrawer && newData.drawingData?.length === 0 && oldData?.drawingData?.length > 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        
    }, (error) => {
        console.error("ルームの監視に失敗:", error);
        alert("ルームとの接続が切れました。");
        leaveRoomButton.click();
    });
}

/**
 * プレイヤーリストUIの更新
 */
function updatePlayerList(players) {
    playerList.innerHTML = "";
    if (!players) return;

    // スコア順にソート (オンライン優先)
    const sortedPlayers = Object.entries(players)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => {
            if (a.isOnline && !b.isOnline) return -1;
            if (!a.isOnline && b.isOnline) return 1;
            return (b.score || 0) - (a.score || 0);
        });

    sortedPlayers.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = `flex justify-between items-center p-2 rounded ${player.isOnline ? 'bg-gray-100' : 'bg-gray-50 text-gray-400'}`;
        
        let name = player.username;
        if (player.id === currentUserId) name += " (あなた)";
        if (player.id === roomData?.currentDrawerId) name = `✏️ ${name}`;

        playerEl.innerHTML = `
            <span class="font-medium truncate">${name}</span>
            <span class="font-bold ${player.isOnline ? 'text-blue-600' : ''}">${player.score || 0} pt</span>
        `;
        playerList.appendChild(playerEl);
    });
}

/**
 * ゲーム状態UIの更新
 */
function updateGameStateUI(data) {
    const isDrawer = data.currentDrawerId === currentUserId;

    // ゲーム状態表示
    switch (data.gameState) {
        case "waiting":
            gameStateDisplay.textContent = "待機中...";
            startGameButton.classList.toggle('hidden', !isDrawer);
            toolbar.classList.add('hidden');
            checkWordButton.classList.add('hidden'); // ★ 待機中は隠す
            wordHint.textContent = "待機中";
            wordHint.classList.add('blur-sm');
            wordHintText.classList.add('hidden');
            break;
        case "drawing":
            gameStateDisplay.textContent = "描画中！";
            startGameButton.classList.add('hidden');
            toolbar.classList.toggle('hidden', !isDrawer);
            // 描画ツールバーのイベントリスナー設定
            setupCanvasListeners(isDrawer);
            
            // ★ お題確認ボタンの表示制御
            const canCheckWord = isDrawer && data.customRules?.showIllustBefore;
            checkWordButton.classList.toggle('hidden', !canCheckWord);

            // お題ヒント
            if (isDrawer) {
                wordHint.textContent = data.currentWord;
                wordHint.classList.remove('blur-sm');
                wordHintText.classList.add('hidden');
            } else {
                if (data.customRules?.hint) {
                    // wordHint.classList.add('hidden'); // 変更: 隠さない
                    wordHint.textContent = "〇".repeat(data.currentWord.length);
                    wordHint.classList.remove('blur-sm'); // 変更: ぼかし解除
                    wordHintText.classList.add('hidden'); // 変更: wordHintTextは使わない
                } else {
                    wordHint.textContent = "お題";
                    wordHint.classList.add('blur-sm');
                    wordHintText.classList.add('hidden');
                }
                // 変更後、ヒントあり/なし両方で wordHint が表示され、wordHintText が隠れるようにする
                wordHint.classList.remove('hidden');
            }
            break;
        case "result":
            gameStateDisplay.textContent = "正解！";
            startGameButton.classList.add('hidden');
            toolbar.classList.add('hidden');
            setupCanvasListeners(false); // 描画停止
            checkWordButton.classList.add('hidden'); // ★ 結果中は隠す
            
            wordHint.textContent = data.currentWord; // 正解表示
            wordHint.classList.remove('blur-sm');
            wordHintText.classList.add('hidden');
            break;
    }
    
    // カスタムルールによるUI切り替え
    dictionarySearchContainer.classList.toggle('hidden', !(data.customRules?.search && !isDrawer && data.gameState === 'drawing'));
}

/**
 * チャットUIの更新 (差分更新)
 */
function updateChat(newMessages, oldMessages = []) {
    if (!newMessages) return;
    
    // 新しいメッセージだけを追加
    const newCount = newMessages.length;
    const oldCount = oldMessages.length;
    
    // ★ 最初の読み込み時（oldMessages がない or 空）はコメントを流さない
    const isInitialLoad = !oldMessages || oldMessages.length === 0;

    if (newCount > oldCount) {
        for (let i = oldCount; i < newCount; i++) {
            const msg = newMessages[i];
            // ★ 差分だけを追加。初期ロード時はコメントを流さない (flow: false)
            addChatMessage(msg.username, msg.text, msg.type, !isInitialLoad);
        }
    } else if (newCount < oldCount) {
        // メッセージがリセットされた場合 (例: ルームリセット)
        chatMessages.innerHTML = "";
        newMessages.forEach(msg => {
            // ★ リセット時もコメントは流さない (flow: false)
            addChatMessage(msg.username, msg.text, msg.type, false);
        });
    }
}


// ----- ゲーム進行 -----

/**
 * ゲーム開始ボタン
 */
startGameButton.addEventListener('click', () => {
    if (roomData.currentDrawerId === currentUserId && roomData.gameState === 'waiting') {
        startTurn();
    }
});

/**
 * 新しいお題を抽選
 */
function pickNewWord() {
    if (dictionary.length === 0) {
        addChatMessage("システム", "辞書が空です。", "system", true); // ★ ゲーム中は流す (flow: true)
        return { word: "エラー", normalized: "えらー" };
    }
    const word = dictionary[Math.floor(Math.random() * dictionary.length)];
    const normalized = normalizeAnswer(word);
    return { word, normalized };
}

/**
 * ターン開始処理 (出題者が実行)
 */
async function startTurn() {
    if (!currentRoomId) return;

    const { word, normalized } = pickNewWord();
    
    // 次ターンタイマーをクリア
    if (turnTimeout) {
        clearTimeout(turnTimeout);
        turnTimeout = null;
    }

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomRef, {
            gameState: "drawing",
            currentWord: word,
            normalizedWord: normalized,
            drawingData: [], // キャンバスリセット
            turnStartTime: Timestamp.now(), // ターン開始時間
            messages: arrayUnion({ // 開始メッセージ
                type: "system",
                username: "システム",
                text: `${currentUsername}さん がお題を描きます。`,
                timestamp: Timestamp.now()
            })
        });

        // カスタムルール: 描画前にイラスト表示
        if (roomData.customRules?.showIllustBefore) {
            showIllustModal("お題のイラスト", word);
        }

    } catch (error) {
        console.error("ターン開始エラー:", error);
    }
}

/**
 * パスボタン
 */
passButton.addEventListener('click', async () => {
    if (roomData.currentDrawerId !== currentUserId || roomData.gameState !== 'drawing') return;

    const { word, normalized } = pickNewWord();
    
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomRef, {
            currentWord: word,
            normalizedWord: normalized,
            drawingData: [], // キャンバスリセット
            messages: arrayUnion({
                type: "system",
                username: "システム",
                text: `${currentUsername}さん がパスしました。お題が変わります。`,
                timestamp: Timestamp.now()
            })
        });

        // パスした場合もイラスト表示
        if (roomData.customRules?.showIllustBefore) {
            showIllustModal("新しいお題のイラスト", word);
        }

    } catch (error) {
        console.error("パスエラー:", error);
    }
});

/**
 * 回答フォーム送信
 */
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !currentRoomId || !roomData) return;

    chatInput.value = ""; // 入力欄をクリア

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    const message = {
        userId: currentUserId,
        username: currentUsername,
        text: text,
        timestamp: Timestamp.now()
    };

    // --- ゲーム中の回答処理 ---
    if (roomData.gameState === 'drawing' && roomData.currentDrawerId !== currentUserId) {
        const normalizedInput = normalizeAnswer(text);
        
        if (normalizedInput === roomData.normalizedWord) {
            // --- 正解！ ---
            handleCorrectAnswer(message);
            return;
        } else {
            // --- 不正解 ---
            message.type = "log";
        }
    } else {
        // --- チャット (待機中 or 自分が描画中) ---
        message.type = "log";
    }

    // チャットログを Firestore に保存
    try {
        await updateDoc(roomRef, {
            messages: arrayUnion(message)
        });
    } catch (error) {
        console.error("チャット送信エラー:", error);
    }
});

/**
 * 正解処理
 */
async function handleCorrectAnswer(correctMessage) {
    if (!roomData || roomData.gameState !== 'drawing') return; // 多重正解防止

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    
    // ポイント計算
    const startTime = roomData.turnStartTime.seconds;
    const elapsedSeconds = Timestamp.now().seconds - startTime;
    const points = Math.max(10, 100 - elapsedSeconds);

    const winnerId = correctMessage.userId;
    const winnerName = correctMessage.username;
    const drawerId = roomData.currentDrawerId;
    const drawerName = roomData.players[drawerId]?.username || '出題者';
    
    correctMessage.type = "correct";
    correctMessage.text = `${correctMessage.text} (正解！ +${points}pt)`;

    try {
        // バッチ処理で更新
        const batch = writeBatch(db);

        // ルーム全体の情報を更新
        batch.update(roomRef, {
            gameState: "result", // 結果表示状態へ
            lastWinner: { // 正解情報を記録
                userId: winnerId,
                username: winnerName,
                points: points
            },
            messages: arrayUnion(correctMessage), // 正解メッセージ
        });

        // 正解者のスコアをインクリメント
        batch.update(roomRef, {
            [`players.${winnerId}.score`]: increment(points)
        });
        
        // 出題者のスコアもインクリメント
        batch.update(roomRef, {
            [`players.${drawerId}.score`]: increment(points)
        });

        await batch.commit();

        // カスタムルール: 結果発表時にイラスト表示
        if (roomData.customRules?.showIllustAfter) {
            showIllustModal(`正解: ${roomData.currentWord}`, roomData.currentWord);
        }

        // 5秒後に次のターンへ
        if (turnTimeout) clearTimeout(turnTimeout); // 念のため
        turnTimeout = setTimeout(startNextTurn, 5000);

    } catch (error) {
        console.error("正解処理エラー:", error);
    }
}

/**
 * 次のターンを開始 (自動実行)
 */
async function startNextTurn() {
    if (!roomData || roomData.gameState !== 'result') return; // 実行条件チェック
    
    // 次の出題者を決定
    const onlinePlayers = Object.entries(roomData.players)
        .filter(([id, data]) => data.isOnline)
        .map(([id, data]) => id);
        
    if (onlinePlayers.length === 0) {
        // 誰もいなくなった
        console.log("誰もいなくなったため待機状態に戻します。");
        // (この処理は実際には退室処理でisOnlineがfalseになった時点で監視側が検知すべき)
        // (もしくは次の参加者がリセットする)
        const roomRef = doc(db, "pictsenseRooms", currentRoomId);
        await updateDoc(roomRef, { gameState: "waiting" }); // とりあえず待機に
        return;
    }

    const currentDrawerIndex = onlinePlayers.indexOf(roomData.currentDrawerId);
    const nextDrawerIndex = (currentDrawerIndex + 1) % onlinePlayers.length;
    const nextDrawerId = onlinePlayers[nextDrawerIndex];

    // 新しいお題を抽選
    const { word, normalized } = pickNewWord();
    
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    const nextDrawerName = roomData.players[nextDrawerId]?.username || '次の人';
    
    try {
        await updateDoc(roomRef, {
            gameState: "drawing",
            currentDrawerId: nextDrawerId,
            currentWord: word,
            normalizedWord: normalized,
            drawingData: [], // キャンバスリセット
            turnStartTime: Timestamp.now(),
            messages: arrayUnion({
                type: "system",
                username: "システム",
                text: `次のターンです。${nextDrawerName}さん がお題を描きます。`,
                timestamp: Timestamp.now()
            })
        });

        // (次の出題者本人にだけ) イラスト表示モーダル
        if (nextDrawerId === currentUserId && roomData.customRules?.showIllustBefore) {
            showIllustModal("お題のイラスト", word);
        }

    } catch (error) {
        console.error("次ターン開始エラー:", error);
    }
}


// ----- 描画処理 -----

/**
 * キャンバスのサイズ調整
 * ★ 削除: 固定サイズ (800x450) のため不要になった
 */
// function resizeCanvas() {
//     const rect = canvasContainer.getBoundingClientRect();
//     canvas.width = rect.width;
//     canvas.height = rect.height;
//     // リサイズ時には再描画
//     if (roomData) {
//         redrawCanvas(roomData.drawingData);
//     }
// }
// window.removeEventListener('resize', resizeCanvas); // ★ 削除

/**
 * キャンバスのイベントリスナー設定 (出題者のみ)
 */
let canvasListenersAttached = false;
function setupCanvasListeners(isDrawer) {
    if (isDrawer && !canvasListenersAttached) {
        // PC (Mouse)
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseout', stopDrawing);
        // Mobile (Touch)
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvasListenersAttached = true;
        
        // 描画バッファ送信タイマーを開始
        if (!sendBufferInterval) {
            sendBufferInterval = setInterval(sendDrawingData, 150); // 100ms -> 150ms (カクつき軽減のため頻度を落とす)
        }
    } else if (!isDrawer && canvasListenersAttached) {
        // リスナーを解除
        canvas.removeEventListener('mousedown', startDrawing);
        canvas.removeEventListener('mousemove', draw);
        canvas.removeEventListener('mouseup', stopDrawing);
        canvas.removeEventListener('mouseout', stopDrawing);
        canvas.removeEventListener('touchstart', startDrawing);
        canvas.removeEventListener('touchmove', draw);
        canvas.removeEventListener('touchend', stopDrawing);
        canvasListenersAttached = false;
        
        // 描画バッファ送信タイマーを停止
        if (sendBufferInterval) {
            clearInterval(sendBufferInterval);
            sendBufferInterval = null;
        }
        drawingBuffer = []; // バッファクリア
    }
}

/**
 * 描画バッファをFirestoreに送信
 */
async function sendDrawingData() {
    if (drawingBuffer.length === 0 || !currentRoomId) return;

    const bufferToSend = [...drawingBuffer];
    drawingBuffer = []; // バッファをクリア

    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomRef, {
            drawingData: arrayUnion(...bufferToSend)
        });
    } catch (error) {
        console.error("描画データの送信に失敗:", error);
        // 送信失敗したデータをバッファに戻す（順序が狂う可能性あり）
        // drawingBuffer = [...bufferToSend, ...drawingBuffer];
    }
}

/**
 * 座標を取得 (Mouse/Touch対応)
 */
function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if (e.touches && e.touches.length > 0) {
        x = e.touches[0].clientX - rect.left;
        y = e.touches[0].clientY - rect.top;
    } else {
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
    }
    // ★ 座標の正規化 (0-1) を 800x450 の固定サイズ基準に変更
    return { x: x / 800, y: y / 450 };
}

/**
 * 描画開始
 */
function startDrawing(e) {
    e.preventDefault();
    isDrawing = true;
    const { x, y } = getCoords(e);
    lastDrawPoint = { x, y };
    
    const strokeColor = (currentTool === 'eraser') ? '#FFFFFF' : currentColor;
    const strokeWidth = currentLineWidth;

    // --- ★ ローカル描画 (redrawCanvasの 'move' と同じ処理) ---
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.moveTo(x * canvas.width, y * canvas.height);
    // --- ローカル描画 END ---
    
    // 1点目(move)のデータをバッファに追加
    const strokeData = {
        type: "move", // 描画開始点
        x: x,
        y: y,
        color: strokeColor,
        width: strokeWidth,
    };
    drawingBuffer.push(strokeData);
}

/**
 * 描画中
 */
function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoords(e);
    
    const strokeColor = (currentTool === 'eraser') ? '#FFFFFF' : currentColor;
    const strokeWidth = currentLineWidth;

    // --- ★ ローカル描画 (redrawCanvasの 'line' と同じ処理) ---
    
    // 色/太さが変わったかチェック
    if (ctx.strokeStyle !== strokeColor || ctx.lineWidth !== strokeWidth) {
        ctx.stroke(); // 今までのパスを描画
        ctx.beginPath(); // 新しいパス
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.moveTo(lastDrawPoint.x * canvas.width, lastDrawPoint.y * canvas.height); // 前回の点から
    }
    
    ctx.lineTo(x * canvas.width, y * canvas.height);
    ctx.stroke(); // 1セグメントごとに描画
    ctx.beginPath(); // 次のセグメントのためにパスをリセット
    ctx.moveTo(x * canvas.width, y * canvas.height); // 現在地から
    // --- ローカル描画 END ---
    
    // 2点目以降(line)のデータをバッファに追加
    const strokeData = {
        type: "line", // 描画継続点
        x: x,
        y: y,
        color: strokeColor,
        width: strokeWidth,
    };
    drawingBuffer.push(strokeData);
    
    // ★ ローカル描画のために lastDrawPoint を更新
    lastDrawPoint = { x, y };
}

/**
 * 描画終了
 */
function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    
    // --- ★ ローカル描画 ---
    ctx.stroke(); // 最後のパスを描画
    // --- ローカル描画 END ---
    
    // 描画終了時にバッファを即時送信
    sendDrawingData();
}

/**
 * キャンバスの再描画 (全員実行)
 */
function redrawCanvas(drawingData) {
    if (!drawingData) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (drawingData.length === 0) return; // 空の場合はクリアして終了 (リセット不具合対応)

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let currentPathColor = null;
    let currentPathWidth = null;

    // ★ 修正: 既存ロジック(1009行目)のバグを修正
    // (最初の move で stroke() が呼ばれるのを防ぐ)
    for (let i = 0; i < drawingData.length; i++) {
        const stroke = drawingData[i];
        const x = stroke.x * canvas.width;
        const y = stroke.y * canvas.height;

        if (stroke.type === 'move') {
            // ★ 修正: i > 0 の場合のみ (つまり最初の move 以外)、前のパスを stroke
            if (i > 0) {
                ctx.stroke(); 
            }
            // 新しいパスを開始
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
        
        } else if (stroke.type === 'line') {
            // パスを継続
            ctx.lineTo(x, y);
            
            // 色や太さが変わったら
            if (stroke.color !== ctx.strokeStyle || stroke.width !== ctx.lineWidth) {
                ctx.stroke(); // 今までのパスを描画
                ctx.beginPath(); // 新しいパス
                ctx.moveTo(x, y); // ★ 修正: 現在地から (既存ロジック通り)
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.width;
            }
        }
    }

    // 最後のパスを描画
    ctx.stroke();
}


// ----- ツールバー・その他UI -----

const colorPaletteButtons = document.querySelectorAll('.color-palette-button');

/**
 * カラーパレット選択
 */
function selectPaletteColor(e) {
    const color = e.currentTarget.dataset.color;
    currentColor = color;
    colorPicker.value = color; // ピッカーの色も同期
    
    // 選択状態のボーダーを管理
    colorPaletteButtons.forEach(btn => btn.classList.remove('border-gray-400', 'border-4'));
    e.currentTarget.classList.add('border-gray-400', 'border-4');
    
    // 色を選んだら自動でペンツールに戻す
    currentTool = 'pen';
    penTool.classList.add('active');
    eraserTool.classList.remove('active');
}
colorPaletteButtons.forEach(button => { button.addEventListener('click', selectPaletteColor); });


/**
 * ツール切り替え
 */
penTool.addEventListener('click', () => {
    currentTool = 'pen';
    penTool.classList.add('active');
    eraserTool.classList.remove('active');
});

eraserTool.addEventListener('click', () => {
    currentTool = 'eraser';
    eraserTool.classList.add('active');
    penTool.classList.remove('active');
});

/**
 * 色変更
 */
colorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    // パレットの選択状態を解除
    colorPaletteButtons.forEach(btn => btn.classList.remove('border-gray-400', 'border-4'));
    // 色を選んだら自動でペンツールに戻す
    currentTool = 'pen';
    penTool.classList.add('active');
    eraserTool.classList.remove('active');
});

/**
 * 太さ変更
 */
lineWidthSlider.addEventListener('input', (e) => {
    currentLineWidth = e.target.value;
    lineWidthDisplay.textContent = currentLineWidth;
});

/**
 * 全消し
 */
clearCanvasButton.addEventListener('click', async () => {
    if (!currentRoomId || roomData.currentDrawerId !== currentUserId) return;
    
    const roomRef = doc(db, "pictsenseRooms", currentRoomId);
    try {
        await updateDoc(roomRef, {
            drawingData: [] // 描画データのみリセット
        });
    } catch (error) {
        console.error("全消しエラー:", error);
    }
});

/**
 * ★ お題確認ボタン (描画中)
 */
checkWordButton.addEventListener('click', () => {
    if (roomData && roomData.currentDrawerId === currentUserId && roomData.gameState === 'drawing') {
        showIllustModal("お題のイラスト", roomData.currentWord);
    }
});

/**
 * 辞書検索
 */
dictionarySearchInput.addEventListener('input', (e) => {
    const query = normalizeAnswer(e.target.value);
    dictionarySearchResults.innerHTML = "";
    if (!query) return;

    const results = dictionary
        .filter(word => normalizeAnswer(word).includes(query))
        .slice(0, 10); // 最大10件

    results.forEach(word => {
        const item = document.createElement('div');
        item.className = 'p-1.5 search-result-item';
        item.textContent = word;
        item.addEventListener('click', () => {
            chatInput.value = word;
            dictionarySearchResults.innerHTML = ""; // 閉じ
            dictionarySearchInput.value = ""; // 閉じ
        });
        dictionarySearchResults.appendChild(item);
    });
});

/**
 * イラストモーダル表示
 */
function showIllustModal(title, cardName) {
    const imgUrl = getCardImageUrl(cardName);
    illustModalTitle.textContent = title;
    illustModalWord.textContent = cardName;
    illustModalImage.src = imgUrl;
    // 画像読み込みエラーハンドリング
    illustModalImage.onerror = () => {
        illustModalImage.alt = "画像が見つかりません";
        illustModalImage.src = ""; // エラーループを防ぐ
    };
    illustModal.classList.remove('hidden');
}

/**
 * イラストモーダル非表示
 */
closeIllustModalButton.addEventListener('click', () => {
    illustModal.classList.add('hidden');
    illustModalImage.src = ""; // メモリ解放
});
// モーダル外クリックでも閉じる (オプション)
illustModal.addEventListener('click', (e) => {
    if (e.target === illustModal) {
        illustModal.classList.add('hidden');
        illustModalImage.src = "";
    }
});