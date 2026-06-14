import TelegramBot from "node-telegram-bot-api";
import express from "express";
import axios from "axios";
import Fuse from "fuse.js";
import dotenv from "dotenv";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ---------- Memory ----------
const userStats = new Map();

// ---------- Admin ----------
function isAdmin(userId) {
  const admins = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  return admins.includes(String(userId));
}

// ---------- Main Menu ----------
function mainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 منوی اصلی", {
    reply_markup: {
      keyboard: [
        ["🔍 جستجوی محصول"],
        ["📞 ارتباط با ما", "📢 کانال اصلی"],
        ["📍 آدرس فروشگاه"]
      ],
      resize_keyboard: true
    }
  });
}

// ---------- Safe Google Sheets ----------
async function getProducts() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json`;
    const res = await axios.get(url, { timeout: 10000 });

    const text = res.data;

    if (!text || typeof text !== "string") return [];

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) return [];

    const json = JSON.parse(text.substring(start, end + 1));

    if (!json?.table?.rows) return [];

    return json.table.rows.map(r => ({
      name: r.c?.[0]?.v || "",
      price: r.c?.[1]?.v || "",
      specs: r.c?.[2]?.v || "",
      status: r.c?.[3]?.v || "نامشخص"
    }));

  } catch (err) {
    console.error("Sheet error:", err.message);
    return [];
  }
}

// ---------- Smart Score ----------
function scoreProduct(text, product) {
  const t = (text || "").toLowerCase();
  const name = (product?.name || "").toLowerCase();
  const specs = (product?.specs || "").toLowerCase();

  let score = 0;

  if (name.includes(t)) score += 5;

  const words = t.split(" ");
  for (const w of words) {
    if (!w) continue;
    if (name.includes(w)) score += 2;
    if (specs.includes(w)) score += 1;
  }

  return score;
}

// ---------- Start ----------
bot.onText(/\/start/, msg => {
  mainMenu(msg.chat.id);
});

// ---------- Admin ----------
bot.onText(/\/admin/, async msg => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ دسترسی ندارید");
  }

  const products = await getProducts();

  return bot.sendMessage(msg.chat.id,
`🛠 پنل ادمین

📦 تعداد محصولات: ${products.length}
👤 آیدی شما: ${msg.from.id}`);
});

// ---------- Message Handler ----------
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  userStats.set(chatId, (userStats.get(chatId) || 0) + 1);

  try {
    // ---------- MENU ----------
    if (text === "🔍 جستجوی محصول") {
      return bot.sendMessage(chatId, "✍️ نام یا توضیح محصول را بنویس:");
    }

    if (text === "📞 ارتباط با ما") {
      return bot.sendMessage(chatId,
`📞 ارتباط با ما

💬 تلگرام: @m1348sh
📱 09143531348`
      );
    }

    if (text === "📢 کانال اصلی") {
      return bot.sendMessage(chatId, "https://t.me/tasisatyeshagi");
    }

    if (text === "📍 آدرس فروشگاه") {
      return bot.sendLocation(chatId, 38.2598767, 48.3091167);
    }

    const products = await getProducts();

    if (!products.length) {
      return bot.sendMessage(chatId, "❌ خطا در دریافت محصولات");
    }

    const fuse = new Fuse(products, {
      keys: ["name", "specs"],
      threshold: 0.5
    });

    let fuseResults = fuse.search(text).map(r => r.item);

    let results = fuseResults
      .map(p => ({
        item: p,
        score: scoreProduct(text, p)
      }))
      .sort((a, b) => b.score - a.score)
      .map(r => r.item);

    if (!results.length) {
      return bot.sendMessage(chatId,
`❌ چیزی پیدا نشد

🔍 دقیق‌تر بنویس`);
    }

    const best = results[0];

    // ---------- EXACT ----------
    if (best?.name && best.name.toLowerCase() === text.toLowerCase()) {
      return sendProduct(chatId, best);
    }

    // ---------- SINGLE ----------
    if (results.length === 1) {
      return sendProduct(chatId, best);
    }

    // ---------- MULTI ----------
    if (results.length <= 10) {
      return bot.sendMessage(chatId,
`🔍 چند نتیجه پیدا شد:

روی محصول کلیک کن 👇`,
      {
        reply_markup: {
          inline_keyboard: results.map(p => ([{
            text: p.name,
            callback_data: `prod_${p.name}`
          }]))
        }
      });
    }

    return bot.sendMessage(chatId,
`🔍 نتایج زیاد است (${results.length})

لطفاً دقیق‌تر بنویس`);
  } catch (err) {
    console.error(err);
    return bot.sendMessage(chatId, "❌ خطا در پردازش درخواست");
  }
});

// ---------- Send Product ----------
function sendProduct(chatId, p) {
  if (!p) return;

  return bot.sendMessage(chatId,
`🛒 ${p.name}

💰 قیمت: ${p.price}
📦 وضعیت: ${p.status}

📝 مشخصات:
${p.specs || "-"}`,
  {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🌐 جستجوی اینترنتی", callback_data: `deep_${p.name}` }],
        [{ text: "🔙 منو", callback_data: "back" }]
      ]
    }
  });
}

// ---------- Callback ----------
bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;

  try {
    if (q.data === "back") {
      return mainMenu(chatId);
    }

    if (q.data.startsWith("prod_")) {
      const name = q.data.replace("prod_", "");
      const products = await getProducts();

      const product = products.find(p => p.name === name);
      if (product) return sendProduct(chatId, product);
    }

    if (q.data.startsWith("deep_")) {
      const query = q.data.replace("deep_", "");
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

      return bot.sendMessage(chatId,
`🌐 جستجوی اینترنتی

🔍 ${query}

${url}`);
    }
  } catch (err) {
    console.error(err);
    return bot.sendMessage(chatId, "❌ خطا در عملیات");
  }
});
