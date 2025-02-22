const API_BASE_URL = 'https://app.attendee.dev/api/v1';
const POLLING_INTERVAL = 5000; // 5 seconds

Deno.serve(async (req) => {
  try {
    const { bot_id } = await req.json();

    if (!bot_id) {
      return new Response(
        JSON.stringify({ error: 'bot_id is required' }), 
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const response = await fetch(`${API_BASE_URL}/bots/${bot_id}/transcript`, {
      method: 'GET',
      headers: {
        'Authorization': `Token Txc3bSfbZG45sencvuAuVTNLPvIfVvhx`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const transcriptData = await response.json();

    return new Response(
      JSON.stringify(transcriptData),
      { 
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error('Error fetching transcript:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch transcript',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}) 