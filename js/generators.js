/* ============================================
   CONTENT GENERATORS
   Template-based generators for weekly prep
   ============================================ */

const Generators = {
  // ---- ICEBREAKERS ----
  // Designed for quick vulnerability & connection, not trivia
  icebreakers: [
    "If you could have dinner with anyone from the Bible, who would it be and what would you ask them?",
    "What's one thing that happened this week that you're grateful for?",
    "If your life had a theme song this week, what would it be?",
    "What's the best piece of advice someone has ever given you?",
    "What's a skill you wish you had and why?",
    "If you could relive one day from the past year, which would it be?",
    "What's something you believed as a kid that you later found out wasn't true?",
    "What's one thing on your bucket list you haven't done yet?",
    "If you could instantly become an expert at something, what would you choose?",
    "What's the most meaningful gift you've ever received?",
    "What's a small act of kindness someone did for you that you'll never forget?",
    "If you had an extra hour every day, how would you spend it?",
    "What's something you've changed your mind about in the last few years?",
    "What's the bravest thing you've ever done?",
    "If you could send a message to your 15-year-old self, what would it say?",
    "What's a tradition you have that means a lot to you?",
    "What's one thing about your life that surprises most people?",
    "What's the hardest lesson you've learned, and how did it shape you?",
    "If you could pick up a new hobby tomorrow with no barriers, what would it be?",
    "What's one thing you want to be known for?",
    "What's a question you wish people would ask you more often?",
    "If you could live anywhere for a year, where would you go?",
    "What's the most spontaneous thing you've ever done?",
    "What does a perfect Saturday look like for you?",
    "What's a fear you've overcome, and how did you do it?",
    "What's something you're working on right now that excites you?",
    "If you could have coffee with anyone alive today, who would it be?",
    "What's a moment in your life that changed your direction?",
    "What does community mean to you in one sentence?",
    "What's one way someone could pray for you this week?"
  ],

  // ---- DISCUSSION QUESTIONS ----
  // Story-based, not knowledge-based. Designed for table groups.
  // Organized by theme for easy matching with weekly topics
  discussionQuestions: {
    general: [
      "What's one thing God has been showing you lately?",
      "Where have you seen God at work in your life this week?",
      "What's one area of your life where you're trusting God right now?",
      "How has your understanding of God changed over the last year?",
      "What does it look like for you to follow Jesus in your everyday life?",
      "What's one step you feel like God is inviting you to take?",
      "When was the last time you felt really close to God?",
      "What's one thing about your faith journey that's been surprising?",
      "How do you handle doubt when it comes?",
      "What role does community play in your faith?"
    ],
    identity: [
      "How would you describe who you are apart from what you do?",
      "What lies about yourself have you had to unlearn?",
      "When do you feel most like yourself?",
      "How has knowing God changed the way you see yourself?",
      "What's one identity struggle you've walked through?"
    ],
    community: [
      "What does real community look like to you?",
      "When have you experienced true belonging?",
      "What makes it hard for you to be vulnerable with others?",
      "How has someone else's story impacted your own?",
      "What's one way you could go deeper in relationship this week?"
    ],
    forgiveness: [
      "What's the hardest thing about forgiveness for you?",
      "Have you ever experienced a forgiveness that changed you?",
      "How do you process hurt in healthy ways?",
      "What does it mean to you that God forgives completely?",
      "Is there an area where you need to extend or receive forgiveness?"
    ],
    purpose: [
      "What do you feel you were made to do?",
      "How do you discover what God is calling you to?",
      "When do you feel most alive and purposeful?",
      "What gifts do you have that others have pointed out?",
      "What would you do if you knew you couldn't fail?"
    ],
    fear: [
      "What's a fear that has held you back from something?",
      "How do you deal with anxiety or worry?",
      "What does courage look like in your daily life?",
      "How has faith helped you face something scary?",
      "What would you do differently if fear wasn't a factor?"
    ],
    generosity: [
      "When has someone's generosity impacted you deeply?",
      "What does it look like to be generous with more than money?",
      "Where is God calling you to give right now?",
      "How does generosity connect to trust in God?",
      "What's one way you could bless someone this week?"
    ],
    growth: [
      "What's one area of your life where you've grown the most?",
      "What has been the most transformative season of your life?",
      "How do you handle seasons that feel stagnant?",
      "What spiritual practice has helped you grow the most?",
      "Who has been the biggest influence on your spiritual growth?"
    ]
  },

  // ---- TEXT MESSAGE TEMPLATES ----
  textTemplates: {
    new: [
      "Hey {name}! It was great meeting you Thursday night. Really glad you came out. No pressure at all, but we'd love to see you again next week. Let me know if you have any questions!",
      "Hey {name}! Just wanted to say thanks for coming out Thursday. I hope you felt welcome. We're here every week and would love to have you back. Let me know if I can help with anything!",
      "Hey {name}, so glad you joined us! I know showing up somewhere new isn't always easy, so thanks for being there. Hope to see you next Thursday!",
      "Hey {name}! Great to have you with us last night. If you're looking for community, you've found a good one. We meet every Thursday at 6:30 — hope to see you there!",
    ],
    missed: [
      "Hey {name}! Missed you Thursday night. Hope everything's good. We'd love to see you when you can make it back!",
      "Hey {name}, just thinking about you — we missed having you there this week. No pressure, just wanted you to know you were on our mind!",
      "Hey {name}! We noticed you weren't there Thursday and just wanted to check in. Hope you're doing well. We're always here if you need anything.",
    ],
    checkin: [
      "Hey {name}! Just checking in — how's your week going? Anything I can be praying about for you?",
      "Hey {name}, thinking of you today. How are things? Praying for a great rest of your week.",
      "Hey {name}! Hope you're having a solid week. Just wanted to say hey and see how you're doing.",
    ],
    invite: [
      "Hey {name}! We've got a great night planned for Thursday at 6:30. Would love to have you there. Food, conversation, good people. You in?",
      "Hey {name}! Just a reminder — Thursday night at 6:30 we're gathering again. Bring a friend if you want! Would love to see you there.",
      "Hey {name}! Wanted to personally invite you to our Thursday gathering this week at 6:30 PM. Great food, real conversation, and solid community. Hope you can make it!",
    ],
    nextStep: [
      "Hey {name}! Loved having you in the conversation Thursday. I think you'd be great at leading a table discussion sometime — would you be open to giving it a try?",
      "Hey {name}, been thinking about what you shared Thursday and it really stood out. You've got a lot to offer this community. Would you be interested in helping us with {area}?",
      "Hey {name}! You've been so consistent and I love that. I wanted to see if you'd be interested in taking a next step with us — maybe helping with the welcome or leading a small group?",
    ]
  },

  // Get a random icebreaker
  getIcebreaker() {
    const idx = Math.floor(Math.random() * this.icebreakers.length);
    return this.icebreakers[idx];
  },

  // Get discussion questions, optionally by theme
  getQuestions(theme = 'general', count = 5) {
    const pool = this.discussionQuestions[theme] || this.discussionQuestions.general;
    // Also pull from general pool to fill if needed
    const generalPool = this.discussionQuestions.general;
    const combined = [...pool];

    // Add general questions if theme pool is small
    if (combined.length < count) {
      for (const q of generalPool) {
        if (!combined.includes(q)) combined.push(q);
      }
    }

    // Shuffle and pick
    const shuffled = combined.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  },

  // Get a text message template
  getText(type, name) {
    const templates = this.textTemplates[type] || this.textTemplates.new;
    const idx = Math.floor(Math.random() * templates.length);
    return templates[idx].replace(/{name}/g, name || '[Name]').replace(/{area}/g, '[specific area]');
  },

  // Get all available themes
  getThemes() {
    return Object.keys(this.discussionQuestions);
  }
};
