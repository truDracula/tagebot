const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
    let { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();

    if (!user) {
        const age = getAge(userId);
        const reward = age * 10;
        
        const { data: newUser } = await supabase.from('users').insert({
            telegram_id: userId, username, account_age_days: age, points: reward, referred_by: refBy
        }).select().single();

        // Give 20% to Inviter
        if (refBy) await supabase.rpc('increment_points', { user_id_param: refBy, amount: reward * 0.20 });
        return res.json(newUser);
    }
    res.json(user);
});

// Daily Ad Logic
app.post('/watch-ad', async (req, res) => {
    const { userId } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
    
    if (user.daily_ads_watched >= 10) return res.status(400).json({ error: 'Limit reached' });

    const { data } = await supabase.from('users').update({ 
        points: user.points + 1000, 
        daily_ads_watched: user.daily_ads_watched + 1 
    }).eq('telegram_id', userId).select().single();
    
    res.json(data);
});

app.listen(process.env.PORT || 3000);