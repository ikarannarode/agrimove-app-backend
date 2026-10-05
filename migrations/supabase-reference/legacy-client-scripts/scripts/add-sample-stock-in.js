const createAdminClient = require('./supabase-client');

async function addSampleStockIn() {
  const supabase = await createAdminClient();
  const [{ data: farmers, error: farmerError }, { data: products, error: productError }] = await Promise.all([
    supabase.from('farmers').select('id, name').order('name'),
    supabase.from('products').select('id, name, unit').order('name'),
  ]);
  if (farmerError) throw farmerError;
  if (productError) throw productError;
  if (!farmers.length || !products.length) {
    throw new Error('Add sample farmers and products before adding sample stock.');
  }

  const examples = [
    { quantity: 100, price: 25 },
    { quantity: 80, price: 38 },
    { quantity: 40, price: 60 },
    { quantity: 150, price: 20 },
    { quantity: 90, price: 30 },
  ];
  const count = Math.min(farmers.length, products.length, examples.length);
  const date = new Date().toISOString().slice(0, 10);
  const rows = Array.from({ length: count }, (_, index) => {
    const example = examples[index];
    const product = products[index];
    return {
      farmer_id: farmers[index].id,
      product_id: product.id,
      quantity: example.quantity,
      unit: product.unit,
      price_per_unit: example.price,
      total_amount: example.quantity * example.price,
      date,
      notes: `Sample stock-in: ${product.name}`,
    };
  });

  const { data, error } = await supabase.from('stock_in').insert(rows).select('id');
  if (error) throw error;
  console.log(`Added ${data.length} sample stock-in records.`);
}

addSampleStockIn().catch((error) => {
  console.error('Could not add sample stock-in data:', error.message);
  process.exitCode = 1;
});
