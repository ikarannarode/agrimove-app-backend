const createAdminClient = require('./supabase-client');

const farmers = [
  { name: 'Ram Singh', phone: '9876543210', address: 'Village Road, Near Temple' },
  { name: 'Gurpreet Kaur', phone: '9876543211', address: 'Main Street, Near School' },
  { name: 'Balwinder Singh', phone: '9876543212', address: 'Farm Road, Near Canal' },
  { name: 'Manpreet Kaur', phone: '9876543213', address: 'Village Center, Near Market' },
];

const products = [
  { name: 'Wheat', unit: 'kg' },
  { name: 'Rice', unit: 'kg' },
  { name: 'Apples', unit: 'kg' },
  { name: 'Potatoes', unit: 'kg' },
  { name: 'Onions', unit: 'kg' },
  { name: 'Tomatoes', unit: 'kg' },
];

const traders = [
  { name: 'Amit Kumar', phone: '9876543220', address: 'Market Street, Shop No. 15' },
  { name: 'Rajesh Sharma', phone: '9876543221', address: 'Wholesale Market, Shop No. 25' },
  { name: 'Suresh Patel', phone: '9876543222', address: 'Main Market, Shop No. 10' },
];

async function insertMissingProducts(supabase) {
  let count = 0;
  for (const product of products) {
    const { data: existing, error: lookupError } = await supabase.from('products')
      .select('id').eq('name', product.name).eq('unit', product.unit).limit(1).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) continue;

    const { error: insertError } = await supabase.from('products').insert(product);
    if (insertError) throw insertError;
    count += 1;
  }
  return count;
}

async function addSampleData() {
  const supabase = await createAdminClient();
  const { data: farmerRows, error: farmerError } = await supabase.from('farmers')
    .upsert(farmers, { onConflict: 'phone' }).select('id');
  if (farmerError) throw farmerError;

  const productCount = await insertMissingProducts(supabase);

  const { data: traderRows, error: traderError } = await supabase.from('traders')
    .upsert(traders, { onConflict: 'phone' }).select('id');
  if (traderError) throw traderError;

  console.log(`Sample data ready: ${farmerRows.length} farmers, ${productCount} new products, ${traderRows.length} traders.`);
}

addSampleData().catch((error) => {
  console.error('Could not add sample data:', error.message);
  process.exitCode = 1;
});
