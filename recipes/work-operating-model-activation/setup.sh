#!/bin/bash

# Work Operating Model Activation Setup Script

echo "🚀 Setting up Work Operating Model Activation..."
echo "================================================"

# Check if we're in the right directory
if [ ! -f "index.ts" ]; then
    echo "❌ Error: index.ts not found. Please run this from the recipe directory."
    exit 1
fi

# Check if deno.json exists
if [ ! -f "deno.json" ]; then
    echo "❌ Error: deno.json not found."
    exit 1
fi

echo "✅ Files verified"

# Generate default user ID
echo ""
echo "📝 Step 1: Generate your DEFAULT_USER_ID"
echo "Run this command and save the result:"
echo "  uuidgen | tr '[:upper:]' '[:lower:]'"
echo ""
echo "Then set it as a Supabase secret:"
echo "  supabase secrets set DEFAULT_USER_ID=your-generated-uuid-here"

# Check if user wants to continue with deployment
echo ""
read -p "Continue with deployment? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Deploy the function
    echo "🚀 Deploying Edge Function..."
    cd /home/ubuntu/open-brain-v2
    npx supabase functions deploy work-operating-model-mcp --no-verify-jwt

    if [ $? -eq 0 ]; then
        echo "✅ Deployment successful!"

        # Get the function URL
        FUNCTION_URL=$(npx supabase functions list | grep work-operating-model-mcp | awk '{print $3}')
        echo ""
        echo "📡 Function URL: $FUNCTION_URL"

        echo ""
        echo "📋 Next Steps:"
        echo "1. Set your environment variables in Supabase:"
        echo "   - SUPABASE_URL: https://zpeedfgyuusscsrirzsg.supabase.co"
        echo "   - SUPABASE_SERVICE_ROLE_KEY: [your service role key]"
        echo "   - MCP_ACCESS_KEY: [your access key]"
        echo "   - DEFAULT_USER_ID: [your generated UUID]"
        echo ""
        echo "2. Run the SQL schema in your Supabase SQL Editor:"
        echo "   - Open: https://supabase.com/dashboard/project/zpeedfgyuusscsrirzsg/sql/new"
        echo "   - Paste the contents of work-operating-model-schema-combined.sql"
        echo ""
        echo "3. Connect it to your AI client using the Remote MCP Connection pattern:"
        echo "   - Connector name: Work Operating Model"
        echo "   - URL: $FUNCTION_URL?key=YOUR_MCP_ACCESS_KEY"
        echo ""
        echo "4. Start the interview by prompting:"
        echo "   'Use the Work Operating Model workflow to interview me and build my operating model.'"
    else
        echo "❌ Deployment failed. Please check the error messages above."
    fi
else
    echo "⏸️ Setup paused. Run this script again when you're ready to deploy."
fi