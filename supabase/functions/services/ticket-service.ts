import { OPENAI_API_KEY, LINEAR_API_KEY } from '../utils/api.ts';
import { LinearClient } from 'npm:@linear/sdk';

// Types
export interface TicketAnalysis {
  type_of_action: 'create_new_ticket' | 'update_ticket' | 'none';
}

export interface TicketData {
  title: string;
  description: string;
  priority: number;
  assigneeId?: string;
  dueDate?: string;
}

export interface LinearTicketResponse {
  success: boolean;
  issue: {
    id: string;
    title: string;
    url: string;
  };
}

// Add new interfaces for cache
interface ConversationCache {
  ticketId: string;
  context: string;
  timestamp: number;
}

// Add cache map at the top level
let conversationTicketCache: ConversationCache[] = [];

// Add cache management functions
function addToCache(ticketId: string, context: string) {
  conversationTicketCache.push({
    ticketId,
    context,
    timestamp: Date.now()
  });
  
  // Cleanup old cache entries (older than 24 hours)
  const ONE_DAY = 24 * 60 * 60 * 1000;
  conversationTicketCache = conversationTicketCache.filter(
    entry => Date.now() - entry.timestamp < ONE_DAY
  );
}

function findRelatedTicket(context: string): string | null {
  // Normalize the input context
  const normalizedInput = context.toLowerCase().trim();
  
  // Extract key topics from the context
  const extractTopics = (text: string): Set<string> => {
    const words = text.split(/[\s,.!?]+/);
    // Filter out common words and keep only meaningful terms
    const meaningfulWords = words.filter(word => 
      word.length > 3 && 
      !['this', 'that', 'have', 'will', 'would', 'could', 'should', 'with'].includes(word)
    );
    return new Set(meaningfulWords);
  };

  const inputTopics = extractTopics(normalizedInput);
  let bestMatch: { ticketId: string; score: number } | null = null;

  for (const cache of conversationTicketCache) {
    const cachedTopics = extractTopics(cache.context.toLowerCase());
    
    // Calculate similarity score
    let matchingWords = 0;
    for (const topic of inputTopics) {
      if (cachedTopics.has(topic)) {
        matchingWords++;
      }
    }

    const similarityScore = matchingWords / Math.max(inputTopics.size, cachedTopics.size);
    
    // Consider it a match if similarity is above 20%
    if (similarityScore > 0.2 && (!bestMatch || similarityScore > bestMatch.score)) {
      bestMatch = { ticketId: cache.ticketId, score: similarityScore };
    }
  }

  return bestMatch?.ticketId || null;
}

// Prompts
const ANALYZE_PROMPT = `You are a Product Manager responsible for extracting actions taken on tickets from conversations. 
Your task is to analyze the conversation provided and determine the appropriate action associated with each task.
Actions should be selected from the following types:
- create_new_ticket
- update_ticket
- none

Focus on identifying work-related topics only. If the conversation includes small talk or unrelated content, do not consider it for ticket creation.

IMPORTANT RULES:
1. If there are any current tickets provided AND the conversation topic is similar to those tickets, ALWAYS return "update_ticket"
2. If the conversation is about a completely new work topic with no related current tickets, return "create_new_ticket"
3. For general discussions, small talk, or follow-ups on existing tickets without new information, return "none"
4. If in doubt whether the topic is similar to existing tickets, prefer "update_ticket" over creating duplicates

For each task mentioned in the conversation, output the corresponding action in a JSON format. The output must strictly follow this format:
{
  "type_of_action": "action_type"
}`;

const TICKET_GENERATION_PROMPT = `Imagine you are a Product Manager instructed to extract action from conversations. Your goal is to analyze the provided conversation and generate a structured Linear ticket in JSON format.

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

// Service functions
export async function analyzeTicket(currentContext: string, windowContext: string = ''): Promise<TicketAnalysis> {
  // Check if the conversation is related to any existing ticket
  const relatedTicketId = findRelatedTicket(currentContext);
  
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
          content: ANALYZE_PROMPT
        },
        {
          role: "user",
          content: `Current context (new conversation): "${currentContext}"
                   Full conversation context: "${windowContext}",
                   Current tickets: ${relatedTicketId ? `[{"id": "${relatedTicketId}"}]` : '[]'}`
        }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

export async function generateTicket(currentContext: string, windowContext: string = ''): Promise<TicketData> {
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
          content: TICKET_GENERATION_PROMPT
        },
        {
          role: "user",
          content: `This is the part of the conversation you need to extract tasks from:

Current context: "${currentContext}"
Previous context: "${windowContext}"

Your task is creating a new ticket.
Today is: "2025-02-23",
`
        }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

export async function createLinearTicket(ticketData: TicketData): Promise<LinearTicketResponse> {
  const linearClient = new LinearClient({ apiKey: LINEAR_API_KEY });

  const teams = await linearClient.teams();
  const team = teams.nodes[0];

  if (!team.id) {
    throw new Error('No team found');
  }

  // Prepare the issue input, excluding dueDate if it's not valid
  const issueInput: any = {
    teamId: team.id,
    title: ticketData.title,
    description: ticketData.description,
    priority: ticketData.priority
  };

  // Add dueDate only if it's a valid date
  if (ticketData.dueDate) {
    issueInput.dueDate = ticketData.dueDate;
  }

  if (ticketData.assigneeId) {
    issueInput.assigneeId = ticketData.assigneeId;
  }

  const issueResponse = await linearClient.createIssue(issueInput);
  const issue = await issueResponse.issue
  console.log("--------------------")
  console.log(issueResponse)
  console.log(issue)
  return {
    success: true,
    issue: {
      id: issue.id,
      title: issue.title,
      url: issue.url
    }
  };
}

export async function updateLinearTicket(
  issueId: string,
  ticketData: TicketData
): Promise<LinearTicketResponse> {
  const linearClient = new LinearClient({ apiKey: LINEAR_API_KEY });

  const teams = await linearClient.teams();
  const team = teams.nodes[0];

  if (!team.id) {
    throw new Error('No team found');
  }

  // Prepare the issue input, excluding undefined values
  const issueInput: any = {
    teamId: team.id,
    title: ticketData.title,
    description: ticketData.description,
    priority: ticketData.priority
  };

  // Add optional fields only if they exist
  if (ticketData.dueDate) {
    issueInput.dueDate = ticketData.dueDate;
  }

  if (ticketData.assigneeId) {
    issueInput.assigneeId = ticketData.assigneeId;
  }

  const issueResponse = await linearClient.updateIssue(issueId, issueInput);
  const issue = await issueResponse.issue
  return {
    success: true,
    issue: {
      id: issue.id,
      title: issue.title,
      url: issue.url
    }
  };
}

// Modify processNewConversation to be more strict about creating new tickets
export async function processNewConversation(
  currentContext: string, 
  windowContext: string = '',
  existingTicketId?: string
): Promise<{ type: string; ticket?: LinearTicketResponse }> {
  // First check cache for related tickets
  const relatedTicketId = existingTicketId || findRelatedTicket(currentContext);
  
  // If we found a related ticket, force update mode
  if (relatedTicketId) {
    const ticketData = await generateTicket(currentContext, windowContext);
    const ticket = await updateLinearTicket(relatedTicketId, ticketData);
    addToCache(ticket.issue.id, currentContext);
    return {
      type: 'ticket_updated',
      ticket
    };
  }

  // Otherwise proceed with normal analysis
  const analysis = await analyzeTicket(currentContext, windowContext);
  
  if (analysis.type_of_action === 'create_new_ticket') {
    const ticketData = await generateTicket(currentContext, windowContext);
    const ticket = await createLinearTicket(ticketData);
    addToCache(ticket.issue.id, currentContext);
    return {
      type: 'ticket_created',
      ticket
    };
  }
  
  return {
    type: analysis.type_of_action
  };
} 