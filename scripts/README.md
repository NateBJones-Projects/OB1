# Qdrant to Supabase Migration Tool

This script migrates vector data from Qdrant to Supabase.

## Prerequisites

1. **Qdrant must be running** on `localhost:6333`
2. **Docker must be installed and running** (or Qdrant installed directly)
3. **Supabase project credentials** - add to `.env` file or environment variables

## Configuration

### Environment Variables

Create a `.env` file in the project root with:

```env
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

### Default Values

The script uses these default values:
- Qdrant URL: `http://localhost:6333`
- Supabase URL: `https://zpeedfgyuusscsuirzsg.supabase.co`
- Default User ID: `74aa7ac8-b6a3-47da-88e5-6e48cb136aa0`
- Batch size: 50 records

## Usage

```bash
# Make sure Qdrant is running first
node scripts/migrate-qdrant-to-supabase.js
```

The script will:
1. Check if Qdrant is running
2. List all collections
3. Filter for relevant collections (thoughts, open_brain, documents, dok)
4. Scroll through all points in each collection
5. Map Qdrant payloads to Supabase format
6. Remove duplicates using content fingerprinting
7. Insert data in batches to Supabase

## Data Mapping

Qdrant fields are mapped to Supabase as follows:

| Qdrant Field | Supabase Field | Notes |
|--------------|----------------|-------|
| `payload.content` | `content` | Main content field |
| `payload.*` | `metadata` | All payload fields except content |
| `vector` | `embedding` | Vector array |
| `user_id` | `user_id` | Fixed to DEFAULT_USER_ID |
| `payload.timestamp` | `created_at` | From payload or current time |
| `crypto.sha256(content)` | `content_fingerprint` | For deduplication |

## Expected Qdrant Collection Names

The script migrates collections that include these names:
- `thoughts`
- `open_brain`
- `document`
- `dok`
- `dok_levels`

## Output

The script provides detailed logging showing:
- Connection status to Qdrant
- Collection found and their sizes
- Progress through pages of points
- Mapping results
- Duplicate removal counts
- Batch insertion status
- Final migration summary

## Troubleshooting

### Qdrant Not Running

If Qdrant is not running, you'll see:
```
✗ Qdrant is not running: Error message...

To start Qdrant, you need to:
1. Install Docker or run Qdrant directly
2. Start Qdrant on localhost:6333
3. Then run this script again
```

### Supabase Authentication Issues

Make sure you have the correct API keys in your `.env` file or environment variables.

### Empty Collections

If no data is migrated, check:
- Qdrant contains data
- Points have `payload.content`
- No permission issues with Supabase

## Testing

To test with sample data:
1. Import some data into Qdrant first
2. Run the migration script
3. Verify the migrated data in Supabase