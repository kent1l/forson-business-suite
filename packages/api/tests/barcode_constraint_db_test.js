const db = require('../db');

async function run() {
  const brandId = 1;
  const groupId = 1;
  const testBarcode = 'TEST-BARCODE-999';
  let createdPartIds = [];

  try {
    console.log('1. Testing duplicate barcode constraint...');
    
    // Insert first part with test barcode
    const res1 = await db.query(
      `INSERT INTO part (brand_id, group_id, barcode, detail) 
       VALUES ($1, $2, $3, 'Test Part 1') RETURNING part_id`,
      [brandId, groupId, testBarcode]
    );
    createdPartIds.push(res1.rows[0].part_id);
    console.log(`Inserted first part with barcode "${testBarcode}", ID: ${res1.rows[0].part_id}`);

    // Try to insert second part with the same barcode
    let errorThrown = null;
    try {
      const res2 = await db.query(
        `INSERT INTO part (brand_id, group_id, barcode, detail) 
         VALUES ($1, $2, $3, 'Test Part 2') RETURNING part_id`,
        [brandId, groupId, testBarcode]
      );
      createdPartIds.push(res2.rows[0].part_id);
    } catch (err) {
      errorThrown = err;
    }

    if (!errorThrown) {
      throw new Error('Expected duplicate barcode insertion to fail, but it succeeded.');
    }

    console.log('Duplicate insertion failed as expected.');
    console.log(`Error code: ${errorThrown.code}`);
    console.log(`Error constraint: ${errorThrown.constraint}`);

    if (errorThrown.code !== '23505') {
      throw new Error(`Expected error code '23505' (unique_violation), got '${errorThrown.code}'`);
    }

    if (errorThrown.constraint !== 'parts_barcode_key') {
      throw new Error(`Expected constraint name 'parts_barcode_key', got '${errorThrown.constraint}'`);
    }

    console.log('✔ Duplicate barcode constraint verified successfully.');

    console.log('\n2. Testing multiple NULL barcodes...');
    
    // Insert first part with NULL barcode
    const resNull1 = await db.query(
      `INSERT INTO part (brand_id, group_id, barcode, detail) 
       VALUES ($1, $2, NULL, 'Test Part Null 1') RETURNING part_id`,
      [brandId, groupId]
    );
    createdPartIds.push(resNull1.rows[0].part_id);
    console.log(`Inserted first part with NULL barcode, ID: ${resNull1.rows[0].part_id}`);

    // Insert second part with NULL barcode
    const resNull2 = await db.query(
      `INSERT INTO part (brand_id, group_id, barcode, detail) 
       VALUES ($1, $2, NULL, 'Test Part Null 2') RETURNING part_id`,
      [brandId, groupId]
    );
    createdPartIds.push(resNull2.rows[0].part_id);
    console.log(`Inserted second part with NULL barcode, ID: ${resNull2.rows[0].part_id}`);

    console.log('✔ Multiple NULL barcodes verified successfully.');
    process.exitCode = 0;

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    // Clean up created parts
    if (createdPartIds.length > 0) {
      console.log('\nCleaning up test parts...');
      try {
        await db.query('DELETE FROM part WHERE part_id = ANY($1)', [createdPartIds]);
        console.log('Cleanup complete.');
      } catch (cleanupErr) {
        console.error('Failed to clean up test parts:', cleanupErr);
      }
    }
    
    if (db && db.end) {
      await db.end();
    }
    console.log('Done.');
  }
}

run();
