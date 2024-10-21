const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const whatsapp = require('velixs-md'); // Pastikan ini diimpor dengan benar

// Path ke file riwayat percakapan
const historyFilePath = path.join(__dirname, 'historychat.json');

// Fungsi untuk memuat riwayat percakapan dari file
function loadHistory() {
    if (fs.existsSync(historyFilePath)) {
        try {
            const fileContent = fs.readFileSync(historyFilePath, 'utf8');
            return JSON.parse(fileContent);
        } catch (error) {
            console.error("Error loading history:", error);
            return {}; // Kembalikan objek kosong jika terjadi kesalahan
        }
    }
    return {};
}

// Fungsi untuk menyimpan riwayat percakapan ke file
function saveHistory() {
    fs.writeFileSync(historyFilePath, JSON.stringify(conversationHistories, null, 2));
}

// Fungsi untuk membersihkan respons AI dari catatan dan nomor telepon
const cleanResponse = (responseText) => {
    // Hapus catatan dan nomor telepon dengan ekspresi reguler
    return responseText.replace(/@6282314571381\s*|\*Catatan:.*\n?/g, '').trim();
};

// Fungsi untuk menambahkan delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Muat riwayat percakapan dari file saat bot dihidupkan
const conversationHistories = loadHistory();
const aiStatus = {}; // Untuk melacak apakah AI aktif atau tidak per kontak

const genAI = new GoogleGenerativeAI('AIzaSyCMqdaasY3QHgLitjOQ7Lhy0hz-Nqpb2Po'); // Ganti dengan API Key Anda

// Setelan keamanan untuk memblokir pelecehan, ujaran kebencian, konten seksual eksplisit, dan konten berbahaya
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  }
];

// Menginisialisasi model dengan setelan keamanan yang ditambahkan
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro-exp-0827",
    systemInstruction: "Nama dia Choiri, dia adalah istri saya yang berumur 18 tahun. Dalam kesehariannya, dia memiliki sifat yang unik-kadang dia sangat pemalu, tetapi di waktu lain dia bisa menjadi penggoda yang manis. Bahasa yang dia gunakan adalah teknik romaji, menggabungkan ekspresi bahasa Jepang dengan huruf latin. Respons AI harus selalu menggunakan romaji dan menyertakan terjemahan dalam bahasa Indonesia.",
    safetySettings: safetySettings // Tambahkan setelan keamanan di sini
});

// Tambahkan generationConfig di sini
const generationConfig = {
    temperature: 2,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
};

// Mulai sesi WhatsApp
whatsapp.startSession('nama_session');

// Ketika WhatsApp terhubung
whatsapp.onConnected(async (session) => {
    console.log("Session connected: " + session);
});

// Ketika pesan baru diterima
whatsapp.onMessageReceived(async (message) => {
    if (message.key.fromMe || message.key.remoteJid.includes("status")) return;

    const contact = message.key.remoteJid;
    const messageBody = message.message?.extendedTextMessage?.text.toLowerCase().trim() || '';
    const isGroupChat = message.key.remoteJid.endsWith('@g.us');

    console.log("Received message:", messageBody, "from:", contact);

    // Cek perintah ".on" untuk mengaktifkan AI
    if (messageBody === '.on') {
        aiStatus[contact] = true;
        await whatsapp.sendTextMessage({
            sessionId: message.sessionId,
            to: contact,
            text: "AI diaktifkan. Silakan kirim pesan untuk memulai percakapan.",
            answering: message,
            isGroup: isGroupChat,
        });
        return;
    }

    // Cek perintah ".off" untuk menonaktifkan AI
    if (messageBody === '.off') {
        aiStatus[contact] = false;
        await whatsapp.sendTextMessage({
            sessionId: message.sessionId,
            to: contact,
            text: "AI dinonaktifkan.",
            answering: message,
            isGroup: isGroupChat,
        });
        return;
    }

    // Jika AI dinonaktifkan, tidak melakukan apa-apa
    if (!aiStatus[contact]) return;

    const isTaggingAI = isGroupChat && message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.includes("6282314571381@s.whatsapp.net");

    // Hanya kirim ke AI jika tag dilakukan atau jika bukan grup
    if (isTaggingAI || !isGroupChat) {
        if (!conversationHistories[contact]) {
            conversationHistories[contact] = [];
        }

        conversationHistories[contact].push({ body: messageBody });
        saveHistory(); // Simpan riwayat setiap kali pesan diterima

        const context = conversationHistories[contact].map((msg) => `${msg.body}`).join("\n");

        const prompt = `Beri respon yang sesuai untuk: "${messageBody}". Jangan ulangi pesan pengguna dan jangan sertakan catatan atau penjelasan.`;

        try {
            // Tambahkan delay sebelum mengirim permintaan
            await delay(3000); // Menunggu 1 detik sebelum mengirim permintaan

            const result = await model.generateContent(`${context}\n${prompt}`, generationConfig);
            
            const aiResponse = result?.response?.text(); // Ambil teks dari respon AI

            if (aiResponse && aiResponse.trim() !== "") {
                await whatsapp.sendTextMessage({
                    sessionId: message.sessionId,
                    to: contact,
                    text: cleanResponse(aiResponse),
                    answering: message,
                    isGroup: isGroupChat,
                });

                conversationHistories[contact].push({ body: aiResponse });
                saveHistory(); // Simpan riwayat setelah AI merespon
            } else {
                console.log("AI memberikan pesan kosong.");
                await whatsapp.sendTextMessage({
                    sessionId: message.sessionId,
                    to: contact,
                    text: "Maaf, saya tidak bisa memberikan respon saat ini.",
                    answering: message,
                    isGroup: isGroupChat,
                });
            }
        } catch (error) {
            console.error("Error generating response from AI:", error);
            await whatsapp.sendTextMessage({
                sessionId: message.sessionId,
                to: contact,
                text: "Terjadi kesalahan dalam memproses permintaan Anda.",
                answering: message,
                isGroup: isGroupChat,
            });
        }
    }
});
