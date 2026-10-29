require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
  if (err) return console.error('Error acquiring PostgreSQL client', err.stack);
  console.log('Successfully connected to PostGIS Spatial Database.');
  release();
});

app.post('/api/parcels/register', async (req, res) => {
  const { parcelCode, county, subCounty, communityName, landCategory, areaHectares, geoJsonPolygon, primaryElderId } = req.body;
  try {
    const overlapQuery = \
      SELECT parcel_id, parcel_code 
      FROM customary_parcels 
      WHERE ST_Overlaps(boundary_geom, ST_SetSRID(ST_GeomFromGeoJSON(\), 4326))
         OR ST_Contains(boundary_geom, ST_SetSRID(ST_GeomFromGeoJSON(\), 4326));
    \;
    const overlapResult = await pool.query(overlapQuery, [JSON.stringify(geoJsonPolygon)]);
    if (overlapResult.rows.length > 0) {
      return res.status(409).json({ status: 'SPATIAL_CONFLICT', conflictingParcels: overlapResult.rows });
    }
    const insertQuery = \
      INSERT INTO customary_parcels (parcel_code, county, sub_county, community_name, land_category, area_hectares, boundary_geom, primary_elder_id)
      VALUES (\, \, \, \, \, \, ST_SetSRID(ST_GeomFromGeoJSON(\), 4326), \)
      RETURNING parcel_id, parcel_code, fpic_state, created_at;
    \;
    const newParcel = await pool.query(insertQuery, [parcelCode, county, subCounty, communityName, landCategory, areaHectares, JSON.stringify(geoJsonPolygon), primaryElderId]);
    return res.status(201).json({ status: 'SUCCESS', data: newParcel.rows[0] });
  } catch (error) {
    console.error('P-GIS Registration Error:', error);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

app.post('/api/revenue/calculate', async (req, res) => {
  const { projectId, grossRevenueUsd, exchangeRateKes } = req.body;
  try {
    const projectRes = await pool.query('SELECT * FROM carbon_projects WHERE project_id = \', [projectId]);
    if (projectRes.rows.length === 0) return res.status(404).json({ error: 'Project not found.' });
    const project = projectRes.rows[0];
    const grossKes = parseFloat(grossRevenueUsd) * parseFloat(exchangeRateKes);
    const communityPoolKes = (grossKes * parseFloat(project.statutory_community_share_pct)) / 100;
    const climateFundKes = (grossKes * parseFloat(project.statutory_climate_fund_pct)) / 100;
    const developerShareKes = (grossKes * parseFloat(project.developer_share_pct)) / 100;
    return res.status(200).json({ currency: 'KES', grossRevenueKes: grossKes, communityPoolKes, climateFundKes, developerShareKes });
  } catch (error) {
    return res.status(500).json({ error: 'Calculation failed.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(\EquiShare Production Backend running on Port \\));
