import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { analyzeTicket } from '../services/ticket-service.ts';

interface AnalyzeRequest {
  currentContext: string;
  windowContext?: string;
}

serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }), 
        { status: 405, headers: corsHeaders }
      );
    }

    const { currentContext, windowContext = '' }: AnalyzeRequest = await req.json();

    if (!currentContext) {
      return new Response(
        JSON.stringify({ error: 'currentContext is required' }), 
        { status: 400, headers: corsHeaders }
      );
    }

    const analysis = await analyzeTicket(currentContext, windowContext);
    return new Response(
      JSON.stringify(analysis),
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error analyzing ticket:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to analyze ticket',
        details: error.message 
      }), 
      { status: 500, headers: corsHeaders }
    );
  }
}); 