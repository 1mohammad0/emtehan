import TelegramBot from "node-telegram-bot-api";
import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();

app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ---------- Memory (برای نگه داشتن نتایج هر کاربر) ----------
const userCache = new Map();

// ---------- Admin ----------
function isAdmin(userId) {
  const admins = (process.env.ADMIN_IDS || "").split(",").map(x => x.trim());
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

// ---------- Get Products ----------
async function getProducts() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json`;
    const res = await axios.get(url, { timeout: 10000 });

    const text = res.data;
    const json = JSON.parse(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1));

    return json.table.rows.map(r => ({
      name: r.c?.[0]?.v || "",
      price: r.c?.[1]?.v || "",
      specs: r.c?.[2]?.v || "",
      status: r.c?.[3]?.v || "نامشخص"
    }));
  } catch (e) {
    console.error(e);
    return [];
  }
}

// ---------- START ----------
bot.onText(/\/start/, msg => mainMenu(msg.chat.id));

// ---------- MESSAGE ----------
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  if (text === "🔍 جستجوی محصول") {
    return bot.sendMessage(chatId, "✍️ نام محصول یا دسته را بنویس:");
  }

  if (text === "📞 ارتباط با ما") {
    return bot.sendMessage(chatId, "📞 @m1348sh\n📱 09143531348");
  }

  if (text === "📢 کانال اصلی") {
    return bot.sendMessage(chatId, "https://t.me/tasisatyeshagi");
  }

  if (text === "📍 آدرس فروشگاه") {
    return bot.sendLocation(chatId, 38.2598767, 48.3091167);
  }

  const products = await getProducts();

  // ---------- FILTER ----------
  const results = products.filter(p =>
    p.name.toLowerCase().includes(text.toLowerCase())
  );

  if (!results.length) {
    return bot.sendMessage(chatId, "❌ چیزی پیدا نشد");
  }

  // ---------- SINGLE ----------
  if (results.length === 1) {
    return sendProduct(chatId, results[0]);
  }

  // ---------- MULTI LIST ----------
  userCache.set(chatId, results);

  return bot.sendMessage(chatId,
`🔍 ${results.length} محصول پیدا شد:

یکی را انتخاب کنید 👇`,
  {
    reply_markup: {
      inline_keyboard: results.map(p => ([{
        text: p.name,
        callback_data: `open_${p.name}`
      }]))
    }
  });
});

// ---------- SHOW PRODUCT ----------
function sendProduct(chatId, product) {
  bot.sendMessage(chatId,
`🛒 ${product.name}

💰 قیمت: ${product.price}
📦 وضعیت: ${product.status}

📝 مشخصات:
${product.specs || "-"}`,
  {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔙 بازگشت", callback_data: "back_list" }
        ],
        [
          { text: "🌐 جستجو در اینترنت", callback_data: `web_${product.name}` }
        ],
        [
          { text: "🤖 پرسش از هوش مصنوعی", callback_data: `ai_${product.name}` }
        ]
      ]
    }
  });
}

// ---------- CALLBACK ----------
bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;

  // BACK TO LIST
  if (q.data === "back_list") {
    const list = userCache.get(chatId);

    if (!list) return mainMenu(chatId);

    return bot.sendMessage(chatId,
`🔙 لیست محصولات:`,
    {
      reply_markup: {
        inline_keyboard: list.map(p => ([{
          text: p.name,
          callback_data: `open_${p.name}`
        }]))
      }
    });
  }

  // OPEN PRODUCT
  if (q.data.startsWith("open_")) {
    const name = q.data.replace("open_", "");
    const products = await getProducts();

    const product = products.find(p => p.name === name);
    if (product) return sendProduct(chatId, product);
  }

  // WEB SEARCH
  if (q.data.startsWith("web_")) {
    const query = q.data.replace("web_", "");
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    return bot.sendMessage(chatId, `🌐 جستجو:\n\n${url}`);
  }

  // AI (placeholder)
  if (q.data.startsWith("ai_")) {
    const query = q.data.replace("ai_", "");

    return bot.sendMessage(chatId,
`🤖 هوش مصنوعی (در نسخه بعدی فعال می‌شود)

🔎 سوال: ${query}

💡 این بخش بعداً به ChatGPT وصل می‌شود`);
  }

  if (q.data === "back") {
    return mainMenu(chatId);
  }
});
