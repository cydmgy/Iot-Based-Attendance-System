const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const backendEnv = path.join(__dirname, '../.env');
  const rootEnv = path.join(__dirname, '../../.env');
  if (fs.existsSync(backendEnv)) {
    require('dotenv').config({ path: backendEnv });
  } else if (fs.existsSync(rootEnv)) {
    require('dotenv').config({ path: rootEnv });
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
