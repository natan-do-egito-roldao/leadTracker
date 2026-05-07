require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const numeroWhatsApp = "15551509469";

let clicks = [];
const leadsRegistrados = new Set();

// 🔐 Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: "credenciais.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = "1cqdwQ8_t5UEM5QPthIiBvvyiQatk1TQvOGsX0ALwHJs";

function encontrarCliqueRecente() {
  const agora = Date.now();
  const limite = 5 * 60 * 1000;

  const recentes = clicks.filter(
    (c) => agora - c.timestamp <= limite
  );

  return recentes.at(-1) || null;
}

async function salvarNoSheets(telefone, mensagem, origem) {
  try {
    console.log("--- Tentando salvar no Google Sheets ---");
    const res = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1", // VERIFIQUE SE O NOME É Sheet1 MESMO
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[telefone, mensagem, origem]],
      },
    });
    console.log("✅ Google Sheets respondeu com Sucesso:", res.status);
  } catch (error) {
    console.error("❌ Erro ao salvar no Sheets:", error.message);
    if (error.response) {
      console.error("Detalhes do erro:", error.response.data);
    }
  }
}

async function leadJaExiste(telefone) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A:A",
  });

  const linhas = response.data.values || [];
  return linhas.some((row) => row[0] === telefone);
}

app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const phone = message.from;
      const text = message.text?.body || "";
      
      // 🚀 A MÁGICA ESTÁ AQUI: Captura o objeto de anúncio nativo
      const referral = message.referral;
      let origem = "organico";

      if (referral) {
        // Se veio de um anúncio, o Meta entrega o ID e o Título do anúncio
        origem = `Ads: ${referral.headline} (ID: ${referral.source_id})`;
        console.log("🎯 Lead vindo de anúncio detectado via Referral!");
      } else {
        // Se não tiver referral, tenta o seu método antigo de IP/Timestamp como fallback
        const clique = encontrarCliqueRecente();
        if (clique) origem = `Clique Link: ${clique.ref}`;
      }

      // Validações de duplicidade que você já tem
      if (message.context) return res.sendStatus(200);
      console.log('contexto');
      if (leadsRegistrados.has(phone)) return res.sendStatus(200);
      console.log('telefone já salvo');

      const jaExiste = await leadJaExiste(phone);
      if (!jaExiste) {
        console.log('já existe mesmo?');
        await salvarNoSheets(phone, text, origem);
        leadsRegistrados.add(phone);
        console.log("🔥 SALVO:", phone, "| Origem:", origem);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    // Altere para ver o erro detalhado da API do Google
    console.error("❌ ERRO DETALHADO:", err.response ? err.response.data : err);
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});