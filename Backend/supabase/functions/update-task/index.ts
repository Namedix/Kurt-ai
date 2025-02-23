

import { LinearClient } from 'npm:@linear/sdk'
import { LINEAR_API_KEY } from '../utils/api.ts';
// Api key authentication
const linearClient = new LinearClient({
  apiKey: LINEAR_API_KEY
})

/** The identifier of the user to assign the issue to. */
// assigneeId?: Maybe<Scalars["String"]>;
/** The issue description in markdown format. */
// description?: Maybe<Scalars["String"]>;
/** The date at which the issue is due. */
// dueDate?: Maybe<Scalars["TimelessDate"]>;
/** The priority of the issue. 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low. */
// priority?: Maybe<Scalars["Int"]>;

Deno.serve(async (req) => {
  const { issueId, title, assigneeId, description, dueDate, priority } = await req.json()
  const teams = await linearClient.teams();
  const team = teams.nodes[0];
  
  if (team.id) {
    const a = await linearClient.updateIssue(issueId, {
      teamId: team.id,
      title,
      assigneeId,
      description,
      dueDate,
      priority
    });
    return new Response(
      JSON.stringify(a),
      { headers: { "Content-Type": "application/json" } },
    )
  }

  return new Response(
    JSON.stringify("ok"),
    { headers: { "Content-Type": "application/json" } },
  )
})
