import TelegramBot from "node-telegram-bot-api";
import express from "express";
import axios from "axios";
import Fuse from "fuse.js";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// ---------- Config ----------
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// ---------- Main Menu ----------
function mainMenu(chatId) {
  bot.sendMessage(chatId, "🏠 منوی اصلی", {
    reply_markup: {
      keyboard: [
        ["🔍 جستجوی محصول"],
        ["📞 ارتباط با ما", "📢 کانال اصلی", "📍 آدرس فروشگاه"]
      ],
      resize_keyboard: true
    }
  });
}

// ---------- Get Products ----------
async function getProducts() {
  const url = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json`;
  const res = await axios.get(url);
  const json = JSON.parse(res.data.substring(47).slice(0, -2));

  return json.table.rows.map(r => ({
    name: r.c[0]?.v || "",
    price: r.c[1]?.v || "",
    specs: r.c[2]?.v || "",
    status: r.c[3]?.v || "نامشخص"
  }));
}

// ---------- Start ----------
bot.onText(/\/start/, msg => {
  mainMenu(msg.chat.id);
});

// ---------- Message Handler ----------
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  if (text === "🔍 جستجوی محصول") {
    return bot.sendMessage(chatId, "✍️ نام محصول را وارد کنید:");
  }

  if (text === "📞 ارتباط با ما") {
    return bot.sendMessage(chatId,
`📞 ارتباط با ما
💬 تلگرام: @m1348sh
📱 09143531348`);
  }

  if (text === "📢 کانال اصلی") {
    return bot.sendMessage(chatId,
`📢 کانال رسمی:
https://t.me/tasisatyeshagi`);
  }

  if (text === "📍 آدرس فروشگاه") {
    return bot.sendLocation(chatId, 38.2598767, 48.3091167);
  }

  // ---------- Product Search ----------
  const products = await getProducts();
  const fuse = new Fuse(products, {
    keys: ["name"],
    threshold: 0.4
  });

  const results = fuse.search(text);

  if (!results.length) {
    return bot.sendMessage(chatId,
`❌ محصولی پیدا نشد
📩 ارتباط با ادمین: @m1348sh`);
  }

  for (let r of results) {
    const p = r.item;

    await bot.sendMessage(chatId,
`🛒 نام کالا: ${p.name}
💰 قیمت: ${p.price}
📦 وضعیت: ${p.status}

📝 مشخصات:
${p.specs}`,
{
  reply_markup: {
    inline_keyboard: [
      [{ text: "🌐 جستجوی عمیق اینترنتی", callback_data: `deep_${p.name}` }],
      [{ text: "🔙 بازگشت به منو", callback_data: "back" }]
    ]
  }
});
  }
});

// ---------- Deep Search + AI Summary ----------
bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;

  if (q.data === "back") return mainMenu(chatId);

  if (q.data.startsWith("deep_")) {
    const productName = q.data.replace("deep_", "");
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(productName)}`;

    let summary = "اطلاعاتی یافت نشد.";

    try {
      // 1️⃣ گرفتن نتایج جستجو
      const searchRes = await axios.get(searchUrl);
      const html = searchRes.data;
      const linkMatch = html.match(/<a rel="nofollow" class="result__a" href="(.*?)">/);

      if (linkMatch && linkMatch[1]) {
        const firstLink = linkMatch[1];

        // 2️⃣ گرفتن متن صفحه
        const pageRes = await axios.get(firstLink);
        let pageText = pageRes.data;

        pageText = pageText.replace(/<script[\s\S]*?<\/script>/gi, "");
        pageText = pageText.replace(/<style[\s\S]*?<\/style>/gi, "");
        pageText = pageText.replace(/<[^>]+>/g, "");
        pageText = pageText.replace(/\s+/g, " ").substring(0, 3500);

        // 3️⃣ خلاصه‌سازی با gpt-4o-mini (اقتصادی)
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.4,
          max_tokens: 220,
          messages: [
            {
              role: "system",
              content: "تو یک کارشناس فروش تجهیزات تاسیساتی هستی و باید معرفی رسمی و خلاصه از محصول بنویسی."
            },
            {
              role: "user",
              content: `این متن درباره ${productName} است. در 4 جمله رسمی و دقیق خلاصه کن:\n\n${pageText}`
            }
          ]
        });

        summary = aiResponse.choices[0].message.content;
      }

    } catch (err) {
      summary = "امکان دریافت اطلاعات از اینترنت وجود ندارد.";
    }

    bot.sendMessage(chatId,
`🌐 جستجوی عمیق اینترنتی

🔍 محصول: ${productName}

📝 معرفی محصول:
${summary}

🔗 لینک سرچ:
https://duckduckgo.com/?q=${encodeURIComponent(productName)}`);
  }
});
