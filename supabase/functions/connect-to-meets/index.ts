import { API_BASE_URL, API_TOKEN, OPENAI_API_KEY } from '../utils/api.ts';

async function getChatResponse(transcript: string) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are MeetingMind, a helpful AI assistant in a meeting. Keep your responses concise and professional."
          },
          {
            role: "user",
            content: transcript
          }
        ],
        temperature: 0.7,
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI Chat API Error:', error);
    return "I apologize, but I'm having trouble processing your request at the moment.";
  }
}

async function analyzeTranscript(transcript: string) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are analyzing meeting transcripts. Respond with 'true' if someone is directly addressing or asking a question to 'MeetingMind', and 'false' otherwise."
          },
          {
            role: "user",
            content: transcript
          }
        ],
        temperature: 0.1,
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.toLowerCase().includes('true');
  } catch (error) {
    console.error('OpenAI API Error:', error);
    return false;
  }
}

async function* pollTranscript(botId: string) {
  let lastTranscript = '';

  while (true) {
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
      const currentTranscript = data.transcript || '';
      
      // Only analyze new content
      if (currentTranscript && currentTranscript !== lastTranscript) {
        const newContent = currentTranscript.slice(lastTranscript.length);
        const isBotAddressed = await analyzeTranscript(newContent);

        if (isBotAddressed) {
          // Get bot's response
          const botResponse = await getChatResponse(newContent);
          
          yield {
            type: 'bot_addressed',
            transcript: newContent,
            response: botResponse,
            timestamp: new Date().toISOString()
          };
        }

        lastTranscript = currentTranscript;
      }

      // Still yield the regular transcript data
      yield {
        type: 'transcript',
        ...data
      };

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
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
}

Deno.serve(async (req) => {
  try {
    const { meeting_url, bot_name = 'MeetingMind' } = await req.json();

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
    const botId = botData.id;

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        
        // Send initial connection success
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          type: 'connection',
          status: 'connected', 
          bot_id: botId 
        })}\n\n`));

        // Start polling for transcript
        for await (const data of pollTranscript(botId)) {
          const message = encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
          controller.enqueue(message);
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
})