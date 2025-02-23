import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import { generateTicket, createLinearTicket } from '../services/ticket-service.ts';

interface CreateTicketRequest {
  currentContext: string;
  windowContext?: string;
}

const SYSTEM_PROMPT = `Imagine you are a Product Manager instructed to extract action from conversations. Your goal is to analyze the provided conversation and generate a structured Linear ticket in JSON format.

Each ticket should include the following fields:

- **title**: A concise summary of the task.
- **description**: A detailed explanation of the task, including any relevant context from the conversation (in markdown format).
- **priority**: A priority level represented by an integer:
  - 0 = No priority
  - 1 = Urgent
  - 2 = High
  - 3 = Normal
  - 4 = Low
- **assigneeId**: The identifier of the user to assign the issue to (if specified).
- **dueDate**: The date at which the issue is due (if mentioned) in the format year-month-day.

Ensure the output is always formatted as valid JSON. Example output:

{
  "title": "Implement user authentication",
  "description": "Develop and integrate user authentication, including login and registration with email and password.",
  "priority": 2,
  "assigneeId": "user_1",
  "dueDate": "2025-03-01"
}

Ensure that the description includes relevant context, and if no assignee or due date is mentioned, those fields should be left empty.`;

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

    const { currentContext, windowContext = '' }: CreateTicketRequest = await req.json();

    if (!currentContext) {
      return new Response(
        JSON.stringify({ error: 'currentContext is required' }), 
        { status: 400, headers: corsHeaders }
      );
    }

    // Generate ticket data using the service
    const ticketData = await generateTicket(currentContext, windowContext);
    console.log(ticketData);
    
    // Create the ticket in Linear using the service
    const linearTicket = await createLinearTicket(ticketData);

    return new Response(
      JSON.stringify({
        ticket: ticketData,
        linear: linearTicket
      }),
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    console.error('Error creating ticket:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to create ticket',
        details: error.message 
      }), 
      { status: 500, headers: corsHeaders }
    );
  }
}); 