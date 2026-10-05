const createAdminClient = require('./supabase-client');

async function addSampleTraders() {
  const supabase = await createAdminClient();
  const traders = [
    { name: 'Rajesh Kumar', phone: '+91-9876543210', address: 'Main Market, Delhi' },
    { name: 'Amit Patel', phone: '+91-9876543211', address: 'Wholesale Market, Mumbai' },
    { name: 'Suresh Singh', phone: '+91-9876543212', address: 'Agricultural Market, Bangalore' },
    { name: 'Mohan Gupta', phone: '+91-9876543213', address: 'Grain Market, Kolkata' },
    { name: 'Vikram Sharma', phone: '+91-9876543214', address: 'Fruit Market, Chennai' },
  ];

  const { data, error } = await supabase.from('traders')
    .upsert(traders, { onConflict: 'phone' })
    .select('id');
  if (error) throw error;
  console.log(`Added or refreshed ${data.length} sample traders.`);
}

addSampleTraders().catch((error) => {
  console.error('Could not add sample traders:', error.message);
  process.exitCode = 1;
});
