// Đi Chùa Online — Server & WebSocket Hub
// Quản lý Chánh Điện Online 2.5D, kết nối TikTok LIVE, bộ lọc ngôn từ văn minh,
// xướng tên đọc kinh tiếng Việt qua Edge TTS và đồng bộ thời gian thực cho Web & Overlay.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TTS_DIR = path.join(__dirname, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
for (const f of fs.readdirSync(TTS_DIR)) { try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch {} }

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

/* ------------------------------------------------------------------ state */
const settings = {
  title: 'Chánh Điện Tịnh Tâm',
  subtitle: 'Nam Mô A Di Đà Phật',
  coupletLeft: 'Từ Bi Tâm Hướng Phật',
  coupletRight: 'Trí Tuệ Sáng Soi Đời',
  voice: 'vi-VN-NamMinhNeural',       // vi-VN-NamMinhNeural hoặc vi-VN-HoaiMyNeural
  pitch: -18,                         // Hz
  rate: -20,                          // %
  music: true,
  mo: true,
  moBpm: 52,
  autoChant: true,
  chantEveryMin: 3,
  seatMode: 'auto',                   // auto | 24 | 36 | 64 | 100
  joinOnEnter: false,
  profanityFilter: true,              // lọc từ ngữ khiếm nhã bảo vệ phòng live
  allowWisdomCards: true,             // cho phép người xem gieo quẻ / rút lời Phật dạy
  gifts: { readAll: true, minDiamonds: 1 },
  widgets: {
    guide: true,
    merit: true,
    timer: true,
    scroll: true,
  }
};

const viewers = new Map();            // id -> { id, name, skin, avatar, coins, merits, joinedAt, lastAt, lastText, lastTextAt, demo }
const startedAt = Date.now();
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '', roomId: '' };
const log = [];

function addLog(s){
  const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${s}`;
  log.push(line);
  if (log.length > 300) log.shift();
  broadcast({ t:'log', line }, 'control');
  console.log(line);
}

const CAPS = [24, 36, 64, 100];
function capacity(){
  if (settings.seatMode !== 'auto') return +settings.seatMode;
  const n = viewers.size;
  return CAPS.find(c => n <= c) || 100;
}

/* ------------------------------------------------------------- Lọc Từ Ngữ */
const PROFANITIES = [
  /\b(dcm|đcm|vcl|đm|dm|đmm|dmm|địt|dit|lồn|lon|cặc|cac|buồi|buoi|đĩ|di~|chó đẻ|óc chó)\b/gi,
  /\b(đụ má|du ma|đụ mẹ|du me|đéo|đẹo|chịch|địt mẹ|dit me|bố mày|mẹ mày|thằng chó|con chó)\b/gi,
];

function sanitize(text){
  if (!text) return '';
  let str = String(text).slice(0, 150);
  if (settings.profanityFilter){
    for (const rx of PROFANITIES){
      str = str.replace(rx, '***');
    }
  }
  return str;
}

function hasProfanity(text){
  if (!text) return false;
  return PROFANITIES.some(rx => {
    rx.lastIndex = 0;
    return rx.test(text);
  });
}

/* ----------------------------------------------------------- Lời Phật Dạy */
const DHARMA_CARDS = [
  { id: 1, title: 'Tâm Dẫn Đầu Mọi Nghiệp', verse: 'Tâm dẫn đầu mọi nghiệp, Tâm chủ, tâm tạo tác. Với tâm ý thanh tịnh, Lời nói việc làm thiện, An lạc bước theo sau, Như bóng không rời hình.', source: 'Kinh Pháp Cú' },
  { id: 2, title: 'Hận Thù Diệt Hận Thù', verse: 'Hận thù diệt hận thù, Đời này không thể có. Từ bi diệt hận thù, Là định luật ngàn thu.', source: 'Kinh Pháp Cú' },
  { id: 3, title: 'Tự Thắng Lấy Mình', verse: 'Thắng vạn quân ngoài chiến trường, Chưa bằng tự thắng lấy tâm mình. Thắng mình là chiến công oanh liệt nhất.', source: 'Kinh Pháp Cú' },
  { id: 4, title: 'Tích Lũy Phước Điền', verse: 'Chớ khinh điều thiện nhỏ, Cho rằng chẳng lợi gì. Từng giọt nước nhỏ tràn bình, Người lành chứa chứa phước đức, Mỗi ngày thêm an vui.', source: 'Kinh Pháp Cú' },
  { id: 5, title: 'An Trú Hiện Tại', verse: 'Quá khứ không tìm cầu, Tương lai không ước vọng. Hãy an trú bây giờ, Thấy rõ pháp hiện tại, Vững vàng không lay chuyển.', source: 'Kinh Nhất Dạ Hiền Giả' },
  { id: 6, title: 'Từ Bi Hỷ Xả', verse: 'Nguyện cho khắp chúng sinh, Thân tâm thường an lạc. Không hiềm hận một ai, Không khinh miệt người nào, Lòng từ bi trùm khắp muôn phương.', source: 'Kinh Từ Bi' },
  { id: 7, title: 'Tâm Như Bàn Thạch', verse: 'Như tảng đá kiên cố, Không gió nào lay chuyển. Người trí tuệ cũng vậy, Giữa khen chê được mất, Tâm thường luôn an nhiên.', source: 'Kinh Pháp Cú' },
  { id: 8, title: 'Tâm Ý Thanh Tịnh', verse: 'Không làm các việc ác, Nguyện làm các việc lành, Giữ tâm ý thanh tịnh, Đó là lời chư Phật.', source: 'Kinh Pháp Cú' },
  { id: 9, title: 'Ánh Sáng Trí Tuệ', verse: 'Trong đêm tối vô minh, Hãy tự mình thắp đuốc lên mà đi. Nương tựa nơi chính mình, Nương tựa nơi Chánh pháp.', source: 'Kinh Đại Bát Niết Bàn' },
  { id: 10, title: 'Hiếu Đạo Vi Tiên', verse: 'Cùng tột điều thiện không gì hơn Hiếu, Cùng tột điều ác không gì hơn Bất hiếu. Cha mẹ tại tiền như Phật tại thế.', source: 'Kinh Báo Hiếu' },
  { id: 11, title: 'Biết Đủ Là An Lạc', verse: 'Người biết đủ dù nằm dưới đất cũng thấy an lạc. Người không biết đủ dù ở thiên đường cũng chưa vừa lòng.', source: 'Kinh Di Giáo' },
  { id: 12, title: 'Buông Xả Phiền Não', verse: 'Giữ giận dữ trong lòng giống như cầm than hồng ném người khác: người bị bỏng đầu tiên chính là ta. Hãy bao dung để tâm thanh thản.', source: 'Lời Phật Dạy' },
  { id: 13, title: 'Lời Nói Ái Ngữ', verse: 'Một lời nói từ bi mang lại niềm tin, một lời nói dịu dàng xoa dịu nỗi đau, một lời nói chân thật thắp sáng bóng đêm.', source: 'Lời Phật Dạy' },
  { id: 14, title: 'Bình Yên Từ Bên Trong', verse: 'Bình yên đến từ bên trong tâm hồn, đừng tìm kiếm nó ở bên ngoài. Khi tâm thanh tịnh, thế gian tự khắc an vui.', source: 'Kinh Pháp Hoa' },
];

function drawWisdomCard(name){
  const card = DHARMA_CARDS[Math.floor(Math.random() * DHARMA_CARDS.length)];
  const cleanName = spoken(name);
  const textAnnouncement = `Phật tử ${cleanName} rút được quẻ thiền: ${card.title}. ${card.verse}`;
  broadcast({ t: 'wisdom', name: cleanName, card });
  say(`Nam mô A Di Đà Phật. Phật tử ${cleanName} được lời Phật dạy: ${card.title}. ${card.verse.slice(0, 120)}`, { tag: 'wisdom' });
  addLog(`📜 ${cleanName} rút quẻ thiền: "${card.title}"`);
  return card;
}

/* ------------------------------------------------------------- Trang Phục */
const SKIN_WORDS = [
  ['master', ['cao tăng','cao tang','hoa thuong','hòa thượng']],
  ['monk', ['sư','su','sư thầy','su thay','thầy','thay','chu tang']],
  ['nun', ['ni','ni cô','ni co','sư cô','su co','chu ni']],
  ['child', ['tiểu','tieu','chú tiểu','chu tieu','bé','be','dong tu']],
  ['granny', ['bà','ba','áo nâu','ao nau','cụ','cu','cu ba']],
  ['woman', ['nữ','nu','chị','chi','gái','gai','ao lam nu']],
  ['man', ['nam','anh','trai','ao lam nam']],
];

function skinFromText(t){
  const w = String(t).toLowerCase().normalize('NFC').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!w || w.split(' ').length > 3) return null;
  for (const [skin, words] of SKIN_WORDS) {
    if (words.some(k => w === k || w.startsWith(k + ' '))) return skin;
  }
  return null;
}
const DEFAULT_SKINS = ['man', 'woman', 'woman', 'man', 'granny'];

function pub(v){ return { id:v.id, name:v.name, skin:v.skin, avatar:v.avatar||'', coins:v.coins, merits:v.merits||v.coins, demo:!!v.demo }; }
function snapshot(){ return { t:'state', settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, tiktok: tiktokState }; }

function seat(id, name, opts = {}){
  let v = viewers.get(id);
  if (v){
    v.lastAt = Date.now();
    if (opts.avatar) v.avatar = opts.avatar;
    return { v, isNew:false };
  }
  if (viewers.size >= 100){
    const quiet = [...viewers.values()].filter(x => x.coins === 0).sort((a,b) => a.lastAt - b.lastAt)[0];
    if (!quiet) return { v:null, isNew:false };
    viewers.delete(quiet.id);
    broadcast({ t:'leave', id: quiet.id });
  }
  v = {
    id,
    name: sanitize((name||id).slice(0, 18)),
    skin: opts.skin || DEFAULT_SKINS[viewers.size % DEFAULT_SKINS.length],
    avatar: opts.avatar || '',
    coins: 0,
    merits: 0,
    joinedAt: Date.now(),
    lastAt: Date.now(),
    demo: !!opts.demo
  };
  viewers.set(id, v);
  broadcast({ t:'join', v: pub(v), cap: capacity() });
  return { v, isNew:true };
}

/* ------------------------------------------------------------- Events */
function onChat(id, name, rawText, avatar){
  const text = sanitize(rawText);
  if (!text) return;

  // Lệnh tương tác đặc biệt
  const lower = text.toLowerCase().trim();
  if (settings.allowWisdomCards && (lower === '!que' || lower === 'que' || lower === 'gieo que' || lower === 'xin que' || lower === 'rut the')){
    drawWisdomCard(name);
    return;
  }

  const want = skinFromText(text);
  const { v, isNew } = seat(id, name, { avatar, skin: want || undefined });
  if (!v) return;

  if (!isNew && want && want !== v.skin){
    v.skin = want;
    broadcast({ t:'skin', id, skin: want });
  }
  v.lastText = text;
  v.lastTextAt = Date.now();
  broadcast({ t:'chat', id, name: v.name, text });
}

function onGift(id, name, rawGiftName, count, diamonds, avatar){
  const giftName = sanitize(rawGiftName || 'quà').slice(0, 30);
  count = Math.max(1, Math.min(9999, +count || 1));
  const { v } = seat(id, name, { avatar });
  if (!v) return;

  const coins = Math.max(1, (diamonds || 1) * (count || 1));
  v.coins += coins;
  v.merits = (v.merits || 0) + coins;

  const hasRecentText = v.lastText && (Date.now() - v.lastTextAt < 90_000) && v.lastText.length > 5 && !hasProfanity(v.lastText);
  const prayer = hasRecentText ? v.lastText : pickPrayer();
  const tier = coins >= 99 ? 3 : coins >= 10 ? 2 : 1;
  const line = `Nam mô A Di Đà Phật. Phật tử ${spoken(v.name)} thành tâm dâng ${giftName}${count > 1 ? ', ' + count + ' lần' : ''}. ${prayer}.`;

  broadcast({ t:'gift', id, name: v.name, giftName, count, coins, total: v.coins, tier, prayer });
  if (settings.gifts.readAll || coins >= settings.gifts.minDiamonds) {
    say(line, { tag:'gift', id });
  }
}

function onScroll(id, name, prayerType, content){
  const cleanName = sanitize(name || 'Phật tử');
  const cleanType = sanitize(prayerType || 'Cầu An');
  const cleanContent = sanitize(content || 'Nguyện cầu gia đạo bình an, vạn sự cát tường');
  broadcast({ t: 'scroll', id, name: cleanName, prayerType: cleanType, content: cleanContent });
  say(`Nam mô A Di Đà Phật. Dâng sớ ${cleanType} cho Phật tử ${spoken(cleanName)}: ${cleanContent}`, { tag: 'scroll' });
  addLog(`📜 Dâng sớ ${cleanType}: ${cleanName} - "${cleanContent}"`);
}

function pickPrayer(){
  const P = [
    'Nguyện cầu gia đạo bình an, vạn sự cát tường',
    'Nguyện cầu cha mẹ mạnh khỏe, phúc thọ trường tồn',
    'Nguyện hồi hướng công đức cho khắp pháp giới chúng sinh',
    'Nguyện cầu thân tâm an lạc, phiền não tiêu trừ',
    'Nguyện cầu công việc hanh thông, tai qua nạn khỏi, phước huệ trang nghiêm'
  ];
  return P[Math.floor(Math.random() * P.length)];
}

const spoken = s => String(s).replace(/[_@.]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'ẩn danh';

/* ------------------------------------------------------------------ TTS */
const ttsQueue = [];
let ttsBusy = false, ttsSeq = 0;

function esc(s){
  return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
}

function say(text, meta = {}){
  if (ttsQueue.length >= 15) {
    addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 câu');
    return;
  }
  ttsQueue.push({ text: String(text).slice(0, 500), meta });
  pumpTTS();
}

async function pumpTTS(){
  if (ttsBusy || !ttsQueue.length) return;
  ttsBusy = true;
  const { text, meta } = ttsQueue.shift();
  try {
    const file = `tts_${Date.now()}_${++ttsSeq}.mp3`;
    const tts = new MsEdgeTTS();
    await tts.setMetadata(settings.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(esc(text), {
      pitch: `${settings.pitch >= 0 ? '+' : ''}${settings.pitch}Hz`,
      rate: `${settings.rate >= 0 ? '+' : ''}${settings.rate}%`
    });
    const chunks = [];
    await new Promise((res, rej) => {
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('close', res);
      audioStream.on('error', rej);
    });
    try { tts.close(); } catch {}
    fs.writeFileSync(path.join(TTS_DIR, file), Buffer.concat(chunks));
    broadcast({ t:'tts', url: `/live/tts/${file}`, text, ...meta });
    const old = fs.readdirSync(TTS_DIR).sort();
    while (old.length > 40) {
      try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {}
    }
  } catch (e) {
    addLog('TTS lỗi: ' + (e?.message || e));
  }
  ttsBusy = false;
  setTimeout(pumpTTS, 50);
}

const CHANTS = [
  'Nam mô Bổn Sư Thích Ca Mâu Ni Phật. Nguyện đem công đức này, hướng về khắp tất cả, đệ tử và chúng sinh, đều trọn thành Phật đạo.',
  'Nam mô A Di Đà Phật. Nguyện sanh Tây Phương Tịnh Độ trung, cửu phẩm liên hoa vi phụ mẫu. Hoa khai kiến Phật ngộ vô sanh, bất thối Bồ Tát vi bạn lữ.',
  'Nam mô Đại Bi Quán Thế Âm Bồ Tát. Nguyện cho khắp cõi nhân gian thân tâm an lạc, tai qua nạn khỏi, nhà nhà ấm no.',
  'Quán Tự Tại Bồ Tát hành thâm Bát Nhã Ba La Mật Đa thời, chiếu kiến ngũ uẩn giai không, độ nhất thiết khổ ách.',
];
let chantIdx = 0, chantTimer = null;
function chant(){
  const text = CHANTS[chantIdx++ % CHANTS.length];
  broadcast({ t:'chant', text });
  say(text, { tag:'chant' });
}
function scheduleChant(){
  clearInterval(chantTimer);
  if (settings.autoChant) chantTimer = setInterval(chant, Math.max(1, settings.chantEveryMin) * 60_000);
}
scheduleChant();

/* --------------------------------------------------------------- TikTok */
let TikTokLib = null;
async function connectTikTok(uniqueId){
  uniqueId = String(uniqueId || '').trim().replace(/^.*tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!uniqueId) return;
  await disconnectTikTok();
  tiktokState = { status: 'connecting', uniqueId, error: '', roomId: '' };
  broadcast({ t:'tiktok', ...tiktokState });

  try {
    TikTokLib ||= await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TikTokLib;
    const conn = new TikTokLiveConnection(uniqueId, { enableExtendedGiftInfo: true, processInitialData: false });
    const av = u => u?.profilePicture?.url?.[0] || u?.profilePicture?.urlList?.[0] || u?.avatarThumb?.urlList?.[0] || '';
    const nm = u => u?.nickname || u?.uniqueId || 'ẩn danh';

    conn.on(WebcastEvent.CHAT, d => onChat(d.user?.uniqueId || d.user?.userId, nm(d.user), d.comment, av(d.user)));
    conn.on(WebcastEvent.GIFT, d => {
      const type = d.giftDetails?.giftType ?? d.extendedGiftInfo?.type;
      if (type === 1 && !d.repeatEnd) return;
      const gname = d.giftDetails?.giftName || d.extendedGiftInfo?.name || 'quà';
      const dia = d.giftDetails?.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 1;
      onGift(d.user?.uniqueId || d.user?.userId, nm(d.user), gname, d.repeatCount || 1, dia, av(d.user));
      addLog(`🎁 ${nm(d.user)} tặng ${gname} x${d.repeatCount || 1}`);
    });
    conn.on(WebcastEvent.MEMBER, d => {
      if (settings.joinOnEnter) seat(d.user?.uniqueId, nm(d.user), { avatar: av(d.user) });
    });
    conn.on(WebcastEvent.LIKE, d => broadcast({ t:'like', id: d.user?.uniqueId, n: d.likeCount || 1 }));
    conn.on(ControlEvent.DISCONNECTED, () => {
      tiktokState = { ...tiktokState, status: 'disconnected' };
      broadcast({ t:'tiktok', ...tiktokState });
      addLog('TikTok: mất kết nối');
    });
    conn.on(ControlEvent.ERROR, e => addLog('TikTok lỗi: ' + (e?.info || e?.message || e)));

    const st = await conn.connect();
    tiktok = conn;
    tiktokState = { status: 'connected', uniqueId, error: '', roomId: st?.roomId || '' };
    addLog(`✅ Đã kết nối live TikTok @${uniqueId}`);
  } catch (e) {
    tiktokState = { status: 'error', uniqueId, error: String(e?.message || e), roomId: '' };
    addLog(`❌ Không kết nối được @${uniqueId}: ${tiktokState.error}`);
  }
  broadcast({ t:'tiktok', ...tiktokState });
}

async function disconnectTikTok(){
  if (tiktok){
    try { await tiktok.disconnect(); } catch {}
    tiktok = null;
  }
  tiktokState = { status:'idle', uniqueId:'', error:'', roomId:'' };
  broadcast({ t:'tiktok', ...tiktokState });
}

/* ------------------------------------------------------------- Dữ liệu Mẫu */
const DEMO_NAMES = ['Diệu Hạnh','Minh Tâm','Thiện Đức','Huệ An','Tịnh Nhã','Quảng Trí','Chơn Như','Pháp Hỷ','Nguyên Thanh','Tâm Đăng','Diệu Liên','Trí Hải','Phước Lộc','Hạnh Nguyện','Như Ý','Bảo Châu','Thanh Lương','Từ Tâm','An Lạc','Giác Hoa','Tuệ Minh','Liên Hương','Thu Hà','Ngọc Lan','Đức Anh','Hải Đăng','Mai Anh','Phương Thảo','Trung Kiên','Quang Huy','Bảo Ngọc','Diệu Linh'];

function fillDemo(n){
  const have = [...viewers.values()].filter(v => v.demo).length;
  for (let i = have; i < n && viewers.size < 100; i++){
    const name = DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ' ' + (Math.floor(i / DEMO_NAMES.length) + 1) : '');
    seat('demo_' + i, name, { demo: true, skin: ['man','woman','woman','man','granny','monk','nun','child'][i % 8] });
  }
}

function clearSeats(){
  viewers.clear();
  broadcast(snapshot());
  addLog('Đã làm trống toàn bộ bồ đoàn');
}

/* ------------------------------------------------------------- Điều Khiển */
function onControl(m){
  switch (m.cmd){
    case 'connect': connectTikTok(m.uniqueId); break;
    case 'disconnect': disconnectTikTok(); addLog('Đã ngắt kết nối TikTok'); break;
    case 'chat': {
      const n = String(m.name || 'Khách').slice(0, 18);
      onChat('sim_' + n, n, String(m.text || 'Nam mô A Di Đà Phật').slice(0, 120));
      break;
    }
    case 'gift': {
      const n = String(m.name || 'Khách').slice(0, 18);
      onGift('sim_' + n, n, String(m.gift || 'Hoa hồng').slice(0, 30), clamp(m.count, 1, 99), clamp(m.diamonds, 1, 50000));
      break;
    }
    case 'fill': fillDemo(clamp(m.n, 1, 100)); addLog(`Đổ người mẫu: ${viewers.size} người`); break;
    case 'clear': clearSeats(); break;
    case 'bell': broadcast({ t:'bell' }); addLog('🔔 Thỉnh đại hồng chung'); break;
    case 'mo': broadcast({ t:'mo1' }); break;
    case 'incense': broadcast({ t:'incense' }); addLog('🪔 Thắp nén tâm hương dâng Phật'); break;
    case 'flower': broadcast({ t:'flower' }); addLog('🪷 Dâng hoa sen'); break;
    case 'lantern': broadcast({ t:'lantern' }); addLog('🏮 Thả đèn hoa đăng cầu an'); break;
    case 'wisdom': {
      drawWisdomCard(m.name || 'Thập Phương Phật Tử');
      break;
    }
    case 'scroll': {
      onScroll(m.id || 'ctl', m.name || 'Phật tử', m.prayerType, m.content);
      break;
    }
    case 'chant': chant(); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say' }); break;
    case 'settings':
      applySettings(m.settings || {});
      scheduleChant();
      broadcast({ t:'settings', settings, cap: capacity() });
      addLog('Đã cập nhật cài đặt Chánh Điện');
      break;
    case 'bots': setBots(!!m.on, +m.n || 12, m.pace); break;
  }
}

const SETTING_RULES = {
  title: v => String(v).slice(0, 40),
  subtitle: v => String(v).slice(0, 60),
  coupletLeft: v => String(v).slice(0, 40),
  coupletRight: v => String(v).slice(0, 40),
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50),
  rate: v => clamp(v, -50, 50),
  moBpm: v => clamp(v, 20, 120),
  chantEveryMin: v => clamp(v, 1, 60),
  music: Boolean,
  mo: Boolean,
  autoChant: Boolean,
  joinOnEnter: Boolean,
  profanityFilter: Boolean,
  allowWisdomCards: Boolean,
  seatMode: v => ['auto', '24', '36', '64', '100'].includes(String(v)) ? String(v) : 'auto',
  widgets: v => typeof v === 'object' && v ? { ...settings.widgets, ...v } : settings.widgets,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
function applySettings(o){
  for (const [k, fn] of Object.entries(SETTING_RULES)){
    if (k in o) settings[k] = fn(o[k]);
  }
}

/* ----------------------------------------------------------------- Bot Giả Lập */
let botTimer = null;
const BOT_LINES = [
  'Nam mô A Di Đà Phật', 'Nam mô Bổn Sư Thích Ca Mâu Ni Phật', 'Cầu cho gia đình bình an, vạn sự lành',
  'Con xin thành tâm sám hối', 'nữ', 'nam', 'bà', 'sư', 'tiểu',
  'Nguyện cầu cha mẹ mạnh khỏe, sống lâu trăm tuổi', 'Mô Phật, thanh tịnh quá',
  'Chúc quý đạo hữu một ngày an lạc', 'Cầu công việc hanh thông thuận buồm xuôi gió',
  '!que', 'gieo que', 'xin que'
];

function setBots(on, n, pace){
  clearInterval(botTimer);
  botTimer = null;
  if (on){
    n = clamp(n, 1, 100);
    for (let i = 0; i < n; i++){
      seat('bot_' + i, DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ·bot', { demo: true });
    }
    const every = { slow: 4000, mid: 1800, fast: 700 }[pace] || 1800;
    botTimer = setInterval(() => {
      const ids = [...viewers.keys()].filter(id => id.startsWith('bot_'));
      if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const v = viewers.get(id);
      if (!v) return;
      const r = Math.random();
      if (r < .58) onChat(id, v.name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
      else if (r < .88) broadcast({ t:'like', id, n: 1 + Math.floor(Math.random() * 4) });
      else if (r < .98) onGift(id, v.name, 'Hoa hồng', 1 + Math.floor(Math.random() * 3), 1);
      else onGift(id, v.name, 'Đèn hoa sen', 1, 99);
    }, every);
    addLog(`🤖 Đã bật ${n} bot mô phỏng, nhịp độ: ${pace}`);
  } else {
    for (const id of [...viewers.keys()]){
      if (id.startsWith('bot_')) {
        viewers.delete(id);
        broadcast({ t:'leave', id });
      }
    }
    addLog('🤖 Đã tắt bot mô phỏng');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- HTTP & Static Server */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`,
  `localhost`, `127.0.0.1`, `[::1]`
]);

const okHost = h => {
  if (!h) return true;
  const cleaned = String(h).toLowerCase().trim();
  return ALLOWED_HOSTS.has(cleaned) || HOST === '0.0.0.0';
};

const SEP = path.sep;

function resolveStatic(urlPath){
  let p = urlPath.split('?')[0];
  if (p === '/' || p === '/index.html') return path.join(ROOT, 'index.html');
  if (p === '/live' || p === '/live/') return path.join(ROOT, 'live', 'control.html');

  // Cho phép phục vụ /assets/ và /live/
  if (!/^\/(assets|live)\//.test(p)) return null;

  // Chặn file ẩn và node_modules
  if (p.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules')) return null;

  // Chặn source code quan trọng
  if (/\.(mjs|json|md|log)$/i.test(p) && !p.startsWith('/assets/')) return null;

  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + SEP)) return null;
  return file;
}

const server = http.createServer((req, res) => {
  if (!okHost(req.headers.host)) {
    res.writeHead(421, { 'Content-Type': 'text/plain' }).end('Host không được chấp nhận');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('URL không hợp lệ');
    return;
  }

  const file = resolveStatic(p);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Không tìm thấy trang yêu cầu');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Tập tin không tồn tại');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/live/tts/') ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

/* -------------------------------------------------------------- WebSocket Server */
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }) => {
    if (!okHost(req.headers.host)) return false;
    if (!origin) return true;
    try { return okHost(new URL(origin).host); } catch { return false; }
  }
});

function broadcast(msg, only){
  const s = JSON.stringify(msg);
  for (const c of wss.clients){
    if (c.readyState === 1 && (!only || c.role === only)) {
      c.send(s);
    }
  }
}

wss.on('connection', (ws, req) => {
  const roleParam = new URL(req.url, 'http://x').searchParams.get('role');
  ws.role = roleParam === 'control' ? 'control' : roleParam === 'web' ? 'web' : 'overlay';

  ws.send(JSON.stringify(snapshot()));
  if (ws.role === 'control') {
    ws.send(JSON.stringify({ t:'logs', lines: log }));
  }

  ws.on('message', buf => {
    try {
      const m = JSON.parse(buf);
      if (ws.role === 'control' && m && m.t === 'ctl') {
        onControl(m);
      } else if (ws.role === 'web' && m && m.t === 'action') {
        // Tương tác từ người dùng web client
        if (m.kind === 'bell') broadcast({ t:'bell' });
        else if (m.kind === 'mo') broadcast({ t:'mo1' });
        else if (m.kind === 'wisdom') drawWisdomCard(m.name || 'Phật tử');
        else if (m.kind === 'scroll') onScroll('web_' + Date.now(), m.name, m.prayerType, m.content);
        else if (m.kind === 'chat') onChat('web_' + Date.now(), m.name, m.text);
      }
    } catch (e) {
      addLog('Lỗi xử lý tin nhắn WebSocket: ' + e.message);
    }
  });
});

server.listen(PORT, HOST, () => {
  addLog(`🌸 Đi Chùa Online Server đang chạy tại:`);
  addLog(`   • Web Trải Nghiệm: http://localhost:${PORT}/`);
  addLog(`   • Bảng Điều Khiển: http://localhost:${PORT}/live/control.html`);
  addLog(`   • Màn Hình Overlay (OBS/TikTok): http://localhost:${PORT}/live/overlay.html`);
});
