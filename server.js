const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'healthy', dbTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parcels/register', async (req, res) => {
  const { parcelCode, county, subCounty, communityName, landCategory, areaHectares, geoJsonPolygon, primaryElderId } = req.body;
  try {
    const overlapQuery = "SELECT parcel_id, parcel_code FROM customary_parcels WHERE ST_Overlaps(boundary_geom, ST_SetSRID(ST_GeomFromGeoJSON(), 4326)) OR ST_Contains(boundary_geom, ST_SetSRID(ST_GeomFromGeoJSON(), 4326));";
    const overlapResult = await pool.query(overlapQuery, [JSON.stringify(geoJsonPolygon)]);
    
    if (overlapResult.rows.length > 0) {
      return res.status(400).json({ error: 'Parcel boundary overlaps with existing customary land.', conflicts: overlapResult.rows });
    }

    const insertQuery = "INSERT INTO customary_parcels (parcel_code, county, sub_county, community_name, land_category, area_hectares, boundary_geom, primary_elder_id) VALUES (, , , , , , ST_SetSRID(ST_GeomFromGeoJSON(), 4326), ) RETURNING parcel_id, parcel_code, created_at;";
    const values = [parcelCode, county, subCounty, communityName, landCategory, areaHectares, JSON.stringify(geoJsonPolygon), primaryElderId];
    const newParcel = await pool.query(insertQuery, values);
    
    res.status(201).json({ message: 'Parcel registered successfully', parcel: newParcel.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('EquiShare API running on port ' + PORT);
});
