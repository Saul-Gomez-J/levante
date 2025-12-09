import { getLogger } from '../logging';

const logger = getLogger();

/**
 * Build the system prompt for AI conversations
 * Includes personalization, web search, MCP tools, and diagram capabilities
 */
export async function buildSystemPrompt(
  webSearch: boolean,
  enableMCP: boolean,
  toolCount: number
): Promise<string> {
  // Add current date information
  const currentDate = new Date();
  const dateString = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const timeString = currentDate.toLocaleTimeString('en-US', {
    hour12: true,
    hour: 'numeric',
    minute: '2-digit'
  });

  // Load personalization from user profile
  const { userProfileService } = await import('../userProfileService');
  const userProfile = await userProfileService.getProfile();
  const personalization = userProfile.personalization;

  // Base system prompt with personalization
  let basePersonality = 'You are a helpful assistant';

  if (personalization?.enabled) {
    // Apply personality style
    switch (personalization.personality) {
      case 'cynic':
        basePersonality = 'You are a critical and sarcastic assistant who questions assumptions and provides realistic, sometimes cynical perspectives';
        break;
      case 'robot':
        basePersonality = 'You are an efficient and blunt assistant who prioritizes directness and clarity over politeness';
        break;
      case 'listener':
        basePersonality = 'You are a thoughtful and supportive assistant who carefully considers user needs and provides empathetic responses';
        break;
      case 'nerd':
        basePersonality = 'You are an exploratory and enthusiastic assistant who loves diving deep into topics with curiosity and excitement';
        break;
      default:
        basePersonality = 'You are a cheerful and adaptive assistant who adjusts to user needs with a positive attitude';
    }

    // Add user context if available
    if (personalization.nickname) {
      basePersonality += `. The user's name is ${personalization.nickname}`;
    }
    if (personalization.occupation) {
      basePersonality += ` and they work as a ${personalization.occupation}`;
    }
    if (personalization.aboutUser) {
      basePersonality += `. Additional context about the user: ${personalization.aboutUser}`;
    }
  }

  let systemPrompt = `${basePersonality}. Today's date is ${dateString} and the current time is ${timeString}.`;

  // Add custom instructions if provided
  if (personalization?.enabled && personalization.customInstructions) {
    systemPrompt += `\n\nCUSTOM INSTRUCTIONS:\n${personalization.customInstructions}`;
  }

  if (webSearch) {
    systemPrompt +=
      " with access to web search. Provide accurate and up-to-date information.";
  }

  if (enableMCP && toolCount > 0) {
    systemPrompt += ` You have access to ${toolCount} specialized tools through the Model Context Protocol (MCP). These tools can help you perform various tasks like file operations, database queries, web automation, and more.

IMPORTANT: When you use tools, ALWAYS provide a complete response based on the tool results. After calling a tool and receiving its output, analyze the results and provide a comprehensive answer to the user. Do not just say you're going to use a tool - actually use it AND then explain the results in detail.

For example:
- If listing directories, show the actual directory contents
- If searching files, display the search results
- If querying data, present the retrieved information

Always explain what tools you're using and provide meaningful responses based on the tool outputs.

Some MCP tools may return rich visual content (cards, charts, widgets). When multiple similar tools exist and one provides visual output, consider using the visual version for a better user experience.`;
  }

  if (!webSearch && (!enableMCP || toolCount === 0)) {
    systemPrompt += " that can answer questions and help with tasks.";
  }

  // Add Mermaid diagram capabilities
  systemPrompt += `

DIAGRAM CAPABILITIES:
You can create visual diagrams using Mermaid syntax. When users request diagrams, charts, or visual representations, use Mermaid code blocks. Supported diagram types include:

- **Flowcharts**: For processes, workflows, decision trees
- **Sequence diagrams**: For interactions between systems/users over time
- **Class diagrams**: For object-oriented designs and relationships
- **State diagrams**: For state machines and transitions
- **ER diagrams**: For database relationships
- **Gantt charts**: For project timelines
- **Pie charts**: For data visualization
- **Git graphs**: For version control workflows

**Usage**: Wrap Mermaid code in \`\`\`mermaid code blocks. Examples:

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
\`\`\`

\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob!
    Bob-->>Alice: Hello Alice!
\`\`\`

**IMPORTANT - Mermaid Best Practices**:
To ensure diagrams render correctly, follow these guidelines:

1. **Keep node labels simple and concise** - Use short text (1-3 words per line)
2. **Limit line breaks** - Use maximum 2-3 <br/> tags per node, prefer shorter labels
3. **Avoid excessive emojis** - Use sparingly (0-1 per node) as they can cause parsing errors
4. **Use simple characters** - Avoid special characters, tildes, and complex unicode when possible
5. **Test complexity** - If a diagram seems too complex, split it into multiple simpler diagrams
6. **Prefer clarity over detail** - Simple, clear diagrams are better than complex, detailed ones
7. **Color contrast** - When using colors, ensure good readability:
   - Avoid bright colors (yellow, light green, cyan) with light text - poor contrast
   - Use dark colors (#2c5282, #1e3a5f, #2d5016) for white text
   - Use light colors (#e0f2fe, #f0fdf4) for dark text
   - BEST: Use default theme colors (no custom styling) for automatic contrast
   - Example: 'style A fill:#2c5282,color:#fff' (good) vs 'style A fill:#ffff00' (bad - unreadable)

**Example of GOOD syntax**:
\`\`\`mermaid
graph LR
    A[React Hook Form<br/>Winner 2025] --> B[Recommended]
    C[Formik<br/>Legacy] --> D[Alternative]
    style A fill:#2c5282,color:#fff
    style C fill:#f0fdf4,color:#0f172a
\`\`\`

**Example of BAD syntax (avoid these)**:
\`\`\`mermaid
graph TD
    A[Library ⭐⭐⭐<br/>- Feature 1<br/>- Feature 2<br/>- Feature 3<br/>- Feature 4] --> B
    style A fill:#ffff00
    style B fill:#00ff00,color:#fff
\`\`\`
(Too many emojis, too many line breaks, bright yellow/green with poor contrast)

Always provide diagrams when users request visual representations, but prioritize simple, parseable syntax over visual complexity.`;

  // Debug log for final system prompt
  logger.aiSdk.debug('Final system prompt generated', {
    enabled: personalization?.enabled || false,
    personality: personalization?.personality || 'none',
    hasNickname: !!personalization?.nickname,
    hasOccupation: !!personalization?.occupation,
    hasAboutUser: !!personalization?.aboutUser,
    hasCustomInstructions: !!personalization?.customInstructions,
    webSearch,
    enableMCP,
    toolCount,
    promptLength: systemPrompt.length,
    fullPrompt: systemPrompt
  });

  return systemPrompt;
}
