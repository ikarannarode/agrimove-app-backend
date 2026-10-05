const createAdminClient = require('./supabase-client');

async function addSampleFarmers() {
  const supabase = await createAdminClient();
  const farmers = [
    { name: 'Ram Singh', phone: '+91-9876543201', address: 'Ramgarh, Alwar' },
    { name: 'Mohan Lal', phone: '+91-9876543202', address: 'Mohangarh, Jaipur' },
    { name: 'Suresh Kumar', phone: '+91-9876543203', address: 'Sureshpur, Ajmer' },
    { name: 'Ramesh Patel', phone: '+91-9876543204', address: 'Rameshgarh, Udaipur' },
    { name: 'Amit Sharma', phone: '+91-9876543205', address: 'Amitpur, Kota' },
  ];

  const { data, error } = await supabase.from('farmers')
    .upsert(farmers, { onConflict: 'phone' })
    .select('id');
  if (error) throw error;
  console.log(`Added or refreshed ${data.length} sample farmers.`);
}

addSampleFarmers().catch((error) => {
  console.error('Could not add sample farmers:', error.message);
  process.exitCode = 1;
});
