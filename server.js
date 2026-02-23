const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const app = express();
app.use(express.json());
app.use(cors());

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
    if (user.referred_by) {
        await supabase.rpc('increment_points', {
            user_id_param: user.referred_by,
            amount: reward * 0.20
        });
    }

    res.json(updatedUser);
});

// Daily Ad Logic
app.post('/watch-ad', async (req, res) => {
    const { userId } = req.body;
    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', userId).single();

    if (userError) return res.status(500).json({ error: userError.message });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if ((user.daily_ads_watched || 0) >= 10) return res.status(400).json({ error: 'Limit reached' });

    const { data, error: updateError } = await supabase.from('users').update({ 
        points: (user.points || 0) + 1000, 
        daily_ads_watched: (user.daily_ads_watched || 0) + 1 
    }).eq('telegram_id', userId).select().single();

    if (updateError) return res.status(500).json({ error: updateError.message });
    
    res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
