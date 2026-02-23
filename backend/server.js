const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const token = process.env.TELEGRAM_BOT_TOKEN;
const webAppUrl = process.env.WEB_APP_URL || 'https://tage-bot-frontend.vercel.app';

async function awardReferralBonus(referredBy, reward) {
    if (!referredBy) return;
    const bonus = Math.floor(reward * 0.2);
    if (bonus <= 0) return;

    // Support either RPC signature: user_id or user_id_param.
    let { error } = await supabase.rpc('increment_points', {
        user_id: referredBy,
        amount: bonus
    });

    if (error) {
        ({ error } = await supabase.rpc('increment_points', {
            user_id_param: referredBy,
            amount: bonus
        }));
    }
}

if (token) {
    const bot = new TelegramBot(token, { polling: true });

    // Respond when a user sends /start with a Web App launch button
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, 'Welcome to $TAGE! Click the button below to launch the app.', {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Launch App', web_app: { url: webAppUrl } }
                ]]
            }
        });
    });

    console.log('Telegram bot polling is active.');
} else {
    console.log('TELEGRAM_BOT_TOKEN not set. Bot polling disabled.');
}

// Logic to estimate account age based on ID sequence
const getAge = (id) => {
    const baseline = 100000000; // Early IDs
    const current = 7500000000; // New IDs
    const totalDays = 4300; // ~12 years of Telegram
    const pos = (id - baseline) / (current - baseline);
    return Math.max(1, Math.floor((1 - pos) * totalDays));
};

app.post('/auth', async (req, res) => {
    const { userId, username, refBy } = req.body;
    let { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', userId).single();

    if (userError && userError.code !== 'PGRST116') return res.status(500).json({ error: userError.message });

    if (!user) {
        const age = getAge(userId);
        const { data: newUser, error: insertError } = await supabase.from('users').insert({
            telegram_id: userId,
            username,
            account_age_days: age,
            points: 0,
            has_claimed_age: false,
            daily_ads_watched: 0,
            referred_by: refBy
        }).select().single();

        if (insertError) return res.status(500).json({ error: insertError.message });
        return res.json(newUser);
    }
    res.json(user);
});

app.post('/claim-age-reward', async (req, res) => {
    const { userId } = req.body;
    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', userId).single();

    if (userError) return res.status(500).json({ error: userError.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.has_claimed_age) return res.json(user);

    const reward = (user.account_age_days || 0) * 10;
    const { data: updatedUser, error: updateError } = await supabase.from('users').update({
        points: (user.points || 0) + reward,
        has_claimed_age: true
    }).eq('telegram_id', userId).select().single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    // Give 20% to inviter when age reward is claimed
    await awardReferralBonus(user.referred_by, reward);

    res.json(updatedUser);
});

app.get('/leaderboard', async (req, res) => {
    const { type } = req.query;

    let query = supabase
        .from('users')
        .select('username, points')
        .order('points', { ascending: false })
        .limit(50);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error });
    res.json(data);
});

app.get('/referrals/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;

    const { data, error } = await supabase
        .from('users')
        .select('username, points')
        .eq('referred_by', telegram_id);

    if (error) return res.status(500).json({ error });
    res.json(data);
});

// Daily Ad Logic
app.post('/watch-ad', async (req, res) => {
    const { userId } = req.body;
    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', userId).single();

    if (userError) return res.status(500).json({ error: userError.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if ((user.daily_ads_watched || 0) >= 10) return res.status(400).json({ error: 'Limit reached' });

    const reward = 1000;
    const { data, error: updateError } = await supabase.from('users').update({ 
        points: (user.points || 0) + reward, 
        daily_ads_watched: (user.daily_ads_watched || 0) + 1 
    }).eq('telegram_id', userId).select().single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    await awardReferralBonus(user.referred_by, reward);
    
    res.json(data);
});

app.post('/complete-task', async (req, res) => {
    const { userId, taskId } = req.body;
    const rewards = {
        1: 5000,
        2: 3000,
        3: 2500
    };
    const reward = rewards[taskId] || 0;

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
    if (userError) return res.status(500).json({ error: userError.message });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data, error: updateError } = await supabase.from('users').update({
        points: (user.points || 0) + reward
    }).eq('telegram_id', userId).select().single();

    if (updateError) return res.status(500).json({ error: updateError.message });

    await awardReferralBonus(user.referred_by, reward);
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
