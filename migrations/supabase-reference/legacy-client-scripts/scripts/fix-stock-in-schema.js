const createAdminClient = require('./supabase-client');

async function verifyStockInSchema() {
  const supabase = await createAdminClient();
  const { error } = await supabase
    .from('stock_in')
    .select('id, price_per_unit, total_amount')
    .limit(1);
  if (error) throw error;
  console.log('The stock_in pricing columns are accessible and the legacy stock schema is ready.');
}

verifyStockInSchema().catch((error) => {
  console.error('Could not verify the stock-in schema:', error.message);
  process.exitCode = 1;
});
