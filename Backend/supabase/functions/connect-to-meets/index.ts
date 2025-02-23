import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { API_BASE_URL, API_TOKEN } from '../utils/api.ts';
import { processNewConversation } from '../services/ticket-service.ts';

interface TicketAnalysis {
  type_of_action: 'create_new_ticket' | 'update_ticket' | 'none';
}

async function* pollTranscript(botId: string, signal: AbortSignal) {
  let lastTranscript = '';
  let windowContext = '';
  console.log('Started polling for bot:', botId);

  while (!signal.aborted) {
    try {
      const response = await fetch(`${API_BASE_URL}/bots/${botId}/transcript`, {
        headers: {
          'Authorization': `Token ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();   
      console.log('Data:', data);
      
      const currentTranscript = data.map(item => `${item.speaker_name}: ${item.transcription.transcript}\n`).join('') || '';
      console.log('Current transcript: \n', currentTranscript);

      if (currentTranscript && currentTranscript !== lastTranscript) {
        try {
          // Process new conversation using the service
          const result = await processNewConversation(
            currentTranscript.slice(lastTranscript.length),
            windowContext
          );

          if (result.type === 'ticket_created' && result.ticket) {
            yield {
              type: 'ticket_created',
              ticket: result.ticket
            };
          }

          if (result.type === 'ticket_updated' && result.ticket) {
            yield {
              type: 'ticket_updated',
              ticket: result.ticket
            };
          }

          // Update window context
          windowContext = currentTranscript;
          lastTranscript = currentTranscript;
        } catch (error) {
          console.error('Error processing conversation:', error);
        }
      }

      await Promise.race([
        new Promise(resolve => setTimeout(resolve, 5000)),
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Polling aborted'))))
      ]);
    } catch (error) {
      if (signal.aborted) {
        console.log('Polling stopped');
        break;
      }
      console.error('Polling error:', error);
      yield { 
        type: 'error',
        error: 'Failed to fetch transcript', 
        details: error.message 
      };
      // Wait before retrying on error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log('Polling ended for bot:', botId);
}

async function leaveMeeting(botId: string) {
  try {
    const response = await fetch(`${API_BASE_URL}/bots/${botId}/leave`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to leave meeting: ${response.status}`);
    }
    console.log(`Bot ${botId} has left the meeting`);
  } catch (error) {
    console.error('Error making bot leave:', error);
  }
}

serve(async (req) => {
  let botId: string;
  let controller: ReadableStreamDefaultController;
  const abortController = new AbortController();
  
  try {
    const { meeting_url, bot_name = 'Kurt' } = await req.json();
    console.log('Received request:', { meeting_url, bot_name });

    if (!meeting_url) {
      return new Response(
        JSON.stringify({ error: 'meeting_url is required' }), 
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Create the bot
    console.log('Creating bot...');
    const response = await fetch(`${API_BASE_URL}/bots`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        "meeting_url": meeting_url,
        "bot_name": bot_name,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const botData = await response.json();
    botId = botData.id;

    // Create SSE stream
    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
        const encoder = new TextEncoder();
        
        // Send initial connection success
        const connectionEvent = {
          type: 'connection',
          status: 'connected', 
          bot_id: botId
        };
        console.log('Sending connection event:', connectionEvent);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(connectionEvent)}\n\n`));

        // Start polling for transcript
        (async () => {
          try {
            for await (const data of pollTranscript(botId, abortController.signal)) {
              if (controller) {  // Check if controller still exists
                const message = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
                controller.enqueue(message);
              } else {
                break;  // Exit if controller is gone
              }
            }
          } catch (error) {
            console.error('Stream error:', error);
          }
        })();
      },

      cancel() {
        console.log('Stream cancelled, cleaning up...');
        controller = null;  // Remove controller reference
        abortController.abort();  // Stop the polling
        if (botId) {
          leaveMeeting(botId).catch(error => {
            console.error('Error during cleanup:', error);
          });
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (error) {
    console.error('Error connecting to meet:', error);
    if (botId) {
      await leaveMeeting(botId);
    }
    return new Response(
      JSON.stringify({ 
        type: 'error',
        error: 'Failed to connect to meeting',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});