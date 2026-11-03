"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};


type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop?: () => void;
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<
      ArrayLike<{ transcript: string }> & { isFinal: boolean }
    >;
  }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};



/* =========================================================
   PARSE RAG SOURCES
   ========================================================= */

function parseAssistantContent(content: string) {
  const metadataStart =
    "__OMNIX_SOURCES__";

  const metadataEnd =
    "__END_OMNIX_SOURCES__";

  let cleanContent = content;

  let sourceMetadata: Source[] = [];

  const metadataStartIndex =
    content.indexOf(metadataStart);

  const metadataEndIndex =
    content.indexOf(metadataEnd);

  if (
    metadataStartIndex !== -1 &&
    metadataEndIndex !== -1 &&
    metadataEndIndex > metadataStartIndex
  ) {
    const metadataStartPosition =
      metadataStartIndex +
      metadataStart.length;

    const metadataJson =
      content.slice(
        metadataStartPosition,
        metadataEndIndex
      );

    try {
      const parsedMetadata =
        JSON.parse(metadataJson);

      if (
        parsedMetadata.type === "sources" &&
        Array.isArray(
          parsedMetadata.sources
        )
      ) {
        sourceMetadata =
          parsedMetadata.sources.filter(
            (source: unknown): source is Source =>
              typeof source === "object" &&
              source !== null &&
              "documentId" in source &&
              "documentName" in source &&
              "pageNumber" in source
          );
      }
    } catch (error) {
      console.error(
        "Failed to parse source metadata:",
        error
      );
    }

    cleanContent =
      content.slice(
        0,
        metadataStartIndex
      ) +
      content.slice(
        metadataEndIndex +
          metadataEnd.length
      );
  }

  const marker =
    /\n---\s*\n\*\*Sources:\*\*\n([\s\S]*)$/;

  const match =
    cleanContent.match(marker);

  if (
    !match ||
    match.index === undefined
  ) {
    return {
      answer: cleanContent,
      sources: sourceMetadata,
    };
  }

  const textSources = match[1]
    .split("\n")
    .map((line) =>
      line
        .replace(/^[-*]\s*/, "")
        .trim()
    )
    .filter(Boolean)
    .map((source) =>
      source.startsWith("📄")
        ? source.slice(1).trim()
        : source
    );

  return {
    answer: cleanContent
      .slice(0, match.index)
      .trimEnd(),

    sources:
      sourceMetadata.length > 0
        ? sourceMetadata
        : textSources.map((source) => ({
            documentId: "",
            documentName: source
              .replace(
                /\s+— Page \d+$/,
                ""
              ),
            pageNumber:
              Number(
                source.match(
                  /— Page (\d+)$/
                )?.[1]
              ) || null,
          })),
  };
}

type UploadedDocument = {
  id: string;
  name: string;
  pages?: number;
  createdAt: string;
};

type Source = {
  documentId: string;
  documentName: string;
  pageNumber: number | null;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [conversationId, setConversationId] =
    useState<string | null>(null);

  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] =
    useState(false);

  const [uploading, setUploading] = useState(false);

  const [uploadedDocuments, setUploadedDocuments] =
    useState<UploadedDocument[]>([]);

  const [openMenuId, setOpenMenuId] =
    useState<string | null>(null);

  const [editingIndex, setEditingIndex] =
    useState<number | null>(null);

  const [actionLoading, setActionLoading] =
    useState(false);

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  /* =========================================================
     LOAD CONVERSATION HISTORY
     ========================================================= */

  useEffect(() => {
    loadConversations();
  }, []);

  /* =========================================================
     RESTORE LAST OPENED CONVERSATION
     ========================================================= */

  useEffect(() => {
    const savedConversationId =
      localStorage.getItem(
        "omnix-conversation-id"
      );

    if (!savedConversationId) {
      return;
    }

    fetch(
      `/api/conversations/${savedConversationId}`
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            "Failed to load conversation"
          );
        }

        return response.json();
      })
      .then((conversation) => {
        const loadedMessages: Message[] =
          conversation.messages.map(
            (item: {
              role: "user" | "assistant";
              content: string;
            }) => ({
              role: item.role,
              content: item.content,
            })
          );

        const loadedDocuments:
          UploadedDocument[] =
          (conversation.documents || []).map(
            (document: {
              id: string;
              name: string;
              createdAt: string;
            }) => ({
              id: document.id,
              name: document.name,
              createdAt: document.createdAt,
            })
          );

        setMessages(loadedMessages);
        setUploadedDocuments(
          loadedDocuments
        );
        setConversationId(
          savedConversationId
        );
      })
      .catch((error) => {
        console.error(
          "Failed to restore conversation:",
          error
        );

        localStorage.removeItem(
          "omnix-conversation-id"
        );

        setConversationId(null);
        setMessages([]);
        setUploadedDocuments([]);
      });
  }, []);

  /* =========================================================
     LOAD CONVERSATIONS
     ========================================================= */

  async function loadConversations() {
    try {
      setLoadingHistory(true);

      const response = await fetch(
        "/api/conversations"
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversations"
        );
      }

      const data = await response.json();

      setConversations(data);
    } catch (error) {
      console.error(
        "Failed to load conversations:",
        error
      );
    } finally {
      setLoadingHistory(false);
    }
  }

  /* =========================================================
     OPEN CONVERSATION
     ========================================================= */

  async function openConversation(id: string) {
    try {
      setOpenMenuId(null);
      setEditingIndex(null);
      setMessage("");

      const response = await fetch(
        `/api/conversations/${id}`
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load conversation"
        );
      }

      const conversation =
        await response.json();

      const loadedMessages: Message[] =
        conversation.messages.map(
          (item: {
            role: "user" | "assistant";
            content: string;
          }) => ({
            role: item.role,
            content: item.content,
          })
        );

      const loadedDocuments:
        UploadedDocument[] =
        (conversation.documents || []).map(
          (document: {
            id: string;
            name: string;
            createdAt: string;
          }) => ({
            id: document.id,
            name: document.name,
            createdAt: document.createdAt,
          })
        );

      setMessages(loadedMessages);
      setUploadedDocuments(
        loadedDocuments
      );
      setConversationId(id);

      localStorage.setItem(
        "omnix-conversation-id",
        id
      );
    } catch (error) {
      console.error(
        "Failed to open conversation:",
        error
      );
    }
  }

  /* =========================================================
     RENAME CONVERSATION
     ========================================================= */

  async function renameConversation(
    id: string,
    currentTitle: string
  ) {
    setOpenMenuId(null);

    const newTitle = window.prompt(
      "Enter a new chat name:",
      currentTitle
    );

    if (newTitle === null) {
      return;
    }

    const trimmedTitle =
      newTitle.trim();

    if (!trimmedTitle) {
      alert(
        "Chat name cannot be empty."
      );
      return;
    }

    try {
      const response = await fetch(
        `/api/conversations/${id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            title: trimmedTitle,
          }),
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to rename chat"
        );
      }

      setConversations(
        (previous) =>
          previous.map(
            (conversation) =>
              conversation.id === id
                ? {
                    ...conversation,
                    title: data.title,
                  }
                : conversation
          )
      );
    } catch (error) {
      console.error(
        "Rename conversation error:",
        error
      );

      alert(
        "Failed to rename chat."
      );
    }
  }

  /* =========================================================
     DELETE CONVERSATION
     ========================================================= */

  async function deleteConversation(
    id: string
  ) {
    setOpenMenuId(null);

    const conversation =
      conversations.find(
        (item) => item.id === id
      );

    const confirmed =
      window.confirm(
        `Delete "${
          conversation?.title ||
          "this chat"
        }"?

This will permanently delete the conversation and its messages.`
      );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/conversations/${id}`,
        {
          method: "DELETE",
        }
      );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to delete conversation"
        );
      }

      setConversations(
        (previous) =>
          previous.filter(
            (conversation) =>
              conversation.id !== id
          )
      );

      if (conversationId === id) {
        setMessages([]);
        setUploadedDocuments([]);
        setConversationId(null);
        setMessage("");
        setEditingIndex(null);

        localStorage.removeItem(
          "omnix-conversation-id"
        );
      }
    } catch (error) {
      console.error(
        "Delete conversation error:",
        error
      );

      alert(
        "Failed to delete chat."
      );
    }
  }

  /* =========================================================
     FILE UPLOAD
     ========================================================= */

  async function uploadPDF(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileName =
      file.name.toLowerCase();

    const isPDF =
      file.type ===
        "application/pdf" ||
      fileName.endsWith(".pdf");

    const isTXT =
      file.type ===
        "text/plain" ||
      fileName.endsWith(".txt");

    const isDOCX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");

    const isCSV =
      file.type === "text/csv" ||
      fileName.endsWith(".csv");

    const isXLSX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      fileName.endsWith(".xlsx");

    const isPPTX =
      file.type ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      fileName.endsWith(".pptx");

    const isImage =
      file.type === "image/jpeg" ||
      file.type === "image/png" ||
      file.type === "image/webp" ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".webp");

    if (
      !isPDF &&
      !isTXT &&
      !isDOCX &&
      !isCSV &&
      !isXLSX &&
      !isPPTX &&
      !isImage
    ) {
      alert(
        "Please select a PDF, TXT, DOCX, CSV, XLSX, PPTX, JPG, JPEG, PNG, or WEBP file."
      );

      event.target.value = "";

      return;
    }

    try {
      setUploading(true);

      const formData =
        new FormData();

      formData.append(
        "file",
        file
      );

      if (conversationId) {
        formData.append(
          "conversationId",
          conversationId
        );
      }

      const response =
        await fetch(
          "/api/upload",
          {
            method: "POST",
            body: formData,
          }
        );

      const responseText =
        await response.text();

      console.log(
        "UPLOAD STATUS:",
        response.status
      );

      console.log(
        "UPLOAD RESPONSE:",
        responseText
      );

      let uploadData: {
        error?: string;
        documentId?: string;
        fileName?: string;
        pages?: number;
        conversationId?: string;
        [key: string]: unknown;
      } = {};

      if (
        responseText.trim()
      ) {
        try {
          uploadData =
            JSON.parse(
              responseText
            );
        } catch (error) {
          console.error(
            "Invalid JSON from upload API:",
            error
          );
        }
      }

      if (!response.ok) {
        throw new Error(
          uploadData.error ||
            `Upload failed with status ${response.status}`
        );
      }

      if (
        uploadData.conversationId
      ) {
        setConversationId(
          uploadData.conversationId
        );

        localStorage.setItem(
          "omnix-conversation-id",
          uploadData.conversationId
        );
      }

      if (
        uploadData.documentId &&
        uploadData.fileName
      ) {
        setUploadedDocuments(
          (previous) => [
            ...previous,
            {
              id:
                uploadData.documentId!,
              name:
                uploadData.fileName!,
              pages:
                typeof uploadData.pages ===
                "number"
                  ? uploadData.pages
                  : undefined,
              createdAt:
                new Date().toISOString(),
            },
          ]
        );
      }

      await loadConversations();

      alert(
        `${file.name} uploaded successfully.`
      );
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to upload file."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  /* =========================================================
     REMOVE DOCUMENT
     ========================================================= */

  async function removeDocument(
    documentId: string
  ) {
    try {
      const response =
        await fetch(
          `/api/documents/${documentId}`,
          {
            method: "DELETE",
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to delete document"
        );
      }

      setUploadedDocuments(
        (previous) =>
          previous.filter(
            (document) =>
              document.id !==
              documentId
          )
      );
    } catch (error) {
      console.error(
        "Remove document error:",
        error
      );

      alert(
        "Failed to remove document."
      );
    }
  }

  /* =========================================================
     SEND MESSAGE
     ========================================================= */



function startVoiceInput() {
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  const SpeechRecognitionAPI =
    speechWindow.SpeechRecognition ||
    speechWindow.webkitSpeechRecognition;

  if (!SpeechRecognitionAPI) {
    alert("Speech recognition is not supported. Please try Google Chrome.");
    return;
  }

  if (isListening) return;

  const recognition = new SpeechRecognitionAPI();
  let finalTranscript = "";
  let interim = "";
  const seenFinalResults = new Set<number>();

  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    interim = "";

    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript?.trim();

      if (!transcript) continue;

      if (result.isFinal) {
        if (!seenFinalResults.has(i)) {
          finalTranscript += (finalTranscript ? " " : "") + transcript;
          seenFinalResults.add(i);
        }
      } else {
        interim += (interim ? " " : "") + transcript;
      }
    }

    setInterimTranscript(interim);
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    setIsListening(false);
    setInterimTranscript("");

    if (event.error === "not-allowed") {
      alert("Please allow microphone access in your browser settings.");
    } else if (event.error !== "no-speech") {
      console.error("Voice input failed:", event.error);
    }
  };

  recognition.onend = () => {
    const completedTranscript = finalTranscript.trim();

    if (completedTranscript) {
      setMessage((previous) => {
        const existing = previous.trim();
        return existing
          ? `${existing} ${completedTranscript}`
          : completedTranscript;
      });
    }

    setInterimTranscript("");
    setIsListening(false);
  };

  try {
    setInterimTranscript("");
    setIsListening(true);
    recognition.start();
  } catch (error) {
    console.error("Could not start voice input:", error);
    setIsListening(false);
    setInterimTranscript("");
  }
}


  function speakResponse(content: string) {
    if (!("speechSynthesis" in window)) {
      alert("Spoken responses are not supported in this browser.");
      return;
    }

    const { answer } = parseAssistantContent(content);
    const cleanText = answer
      .replace(/```[\s\S]*?```/g, "Code block omitted.")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_`~]/g, "")
      .trim();

    if (!cleanText) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }


  async function sendMessage() {
    const trimmedMessage =
      message.trim();

    if (
      !trimmedMessage ||
      loading ||
      actionLoading
    ) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: trimmedMessage,
    };

    setMessage("");

    setMessages(
      (previous) => [
        ...previous,
        userMessage,
      ]
    );

    setLoading(true);

    let assistantResponse = "";

    setMessages(
      (previous) => [
        ...previous,
        {
          role: "assistant",
          content: "",
        },
      ]
    );

    try {
      const response =
        await fetch(
          "/api/chat",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              conversationId,
              messages: [
                ...messages,
                userMessage,
              ],
            }),
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        throw new Error(
          errorText ||
            "Failed to send message"
        );
      }

      const newConversationId =
        response.headers.get(
          "X-Conversation-Id"
        );

      if (
        newConversationId
      ) {
        setConversationId(
          newConversationId
        );

        localStorage.setItem(
          "omnix-conversation-id",
          newConversationId
        );
      }

      if (!response.body) {
        throw new Error(
          "No response body"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        assistantResponse +=
          chunk;

        setMessages(
          (previous) => {
            const updated =
              [...previous];

            updated[
              updated.length - 1
            ] = {
              role: "assistant",
              content:
                assistantResponse,
            };

            return updated;
          }
        );
      }

      await loadConversations();
    } catch (error) {
      console.error(
        "Send message error:",
        error
      );

      setMessages(
        (previous) => {
          const updated =
            [...previous];

          updated[
            updated.length - 1
          ] = {
            role: "assistant",
            content:
              error instanceof Error
                ? `Sorry, I couldn't complete that request.\n\n${error.message}`
                : "Sorry, I couldn't complete that request.",
          };

          return updated;
        }
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     NEW CHAT
     ========================================================= */

  function newChat() {
    setMessages([]);
    setUploadedDocuments([]);
    setConversationId(null);
    setMessage("");
    setEditingIndex(null);
    setOpenMenuId(null);

    localStorage.removeItem(
      "omnix-conversation-id"
    );
  }

  /* =========================================================
     START EDITING MESSAGE
     ========================================================= */

  function startEditingMessage(
    index: number
  ) {
    const target =
      messages[index];

    if (
      !target ||
      target.role !== "user"
    ) {
      return;
    }

    setEditingIndex(index);
    setMessage(target.content);
  }

  /* =========================================================
     CANCEL EDIT
     ========================================================= */

  function cancelEditing() {
    setEditingIndex(null);
    setMessage("");
  }

  /* =========================================================
     EDIT MESSAGE
     ========================================================= */

  async function editMessage() {
    if (
      editingIndex === null ||
      !message.trim() ||
      actionLoading ||
      loading
    ) {
      return;
    }

    const index =
      editingIndex;

    const updatedMessages =
      messages.slice(
        0,
        index + 1
      );

    updatedMessages[index] = {
      role: "user",
      content:
        message.trim(),
    };

    setMessages(
      updatedMessages
    );

    setEditingIndex(null);
    setMessage("");
    setActionLoading(true);
    setLoading(true);

    let assistantResponse = "";

    setMessages(
      (previous) => [
        ...previous,
        {
          role: "assistant",
          content: "",
        },
      ]
    );

    try {
      const response =
        await fetch(
          "/api/chat/actions",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              mode: "edit",
              conversationId,
              messageIndex: index,
              messages:
                updatedMessages,
            }),
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        throw new Error(
          errorText ||
            "Failed to edit message"
        );
      }

      const newConversationId =
        response.headers.get(
          "X-Conversation-Id"
        );

      if (
        newConversationId
      ) {
        setConversationId(
          newConversationId
        );

        localStorage.setItem(
          "omnix-conversation-id",
          newConversationId
        );
      }

      if (!response.body) {
        throw new Error(
          "No response body"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        assistantResponse +=
          chunk;

        setMessages(
          (previous) => {
            const updated =
              [...previous];

            updated[
              updated.length - 1
            ] = {
              role: "assistant",
              content:
                assistantResponse,
            };

            return updated;
          }
        );
      }

      await loadConversations();
    } catch (error) {
      console.error(
        "Edit message error:",
        error
      );

      setMessages(
        (previous) => {
          const updated =
            [...previous];

          updated[
            updated.length - 1
          ] = {
            role: "assistant",
            content:
              error instanceof Error
                ? `Sorry, I couldn't complete that request.\n\n${error.message}`
                : "Sorry, I couldn't complete that request.",
          };

          return updated;
        }
      );
    } finally {
      setActionLoading(false);
      setLoading(false);
    }
  }

  /* =========================================================
     REGENERATE MESSAGE
     ========================================================= */

  async function regenerateMessage() {
    if (
      loading ||
      actionLoading ||
      !conversationId
    ) {
      return;
    }

    const lastUserIndex =
      messages.findLastIndex(
        (item) =>
          item.role === "user"
      );

    if (
      lastUserIndex === -1
    ) {
      return;
    }

    const previousMessages =
      messages.slice(
        0,
        lastUserIndex + 1
      );

    setMessages(
      previousMessages
    );

    setActionLoading(true);
    setLoading(true);

    let assistantResponse = "";

    setMessages(
      (previous) => [
        ...previous,
        {
          role: "assistant",
          content: "",
        },
      ]
    );

    try {
      const response =
        await fetch(
          "/api/chat/actions",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              mode: "regenerate",
              conversationId,
              messages:
                previousMessages,
            }),
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        throw new Error(
          errorText ||
            "Failed to regenerate response"
        );
      }

      if (!response.body) {
        throw new Error(
          "No response body"
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      while (true) {
        const {
          value,
          done,
        } = await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(
            value,
            {
              stream: true,
            }
          );

        assistantResponse +=
          chunk;

        setMessages(
          (previous) => {
            const updated =
              [...previous];

            updated[
              updated.length - 1
            ] = {
              role: "assistant",
              content:
                assistantResponse,
            };

            return updated;
          }
        );
      }

      await loadConversations();
    } catch (error) {
      console.error(
        "Regenerate message error:",
        error
      );

      setMessages(
        (previous) => {
          const updated =
            [...previous];

          updated[
            updated.length - 1
          ] = {
            role: "assistant",
            content:
              error instanceof Error
                ? `Sorry, I couldn't complete that request.\n\n${error.message}`
                : "Sorry, I couldn't complete that request.",
          };

          return updated;
        }
      );
    } finally {
      setActionLoading(false);
      setLoading(false);
    }
  }

  /* =========================================================
     KEYBOARD HANDLER
     ========================================================= */

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      if (
        editingIndex !== null
      ) {
        editMessage();
      } else {
        sendMessage();
      }
    }
  }

  /* =========================================================
     FILTER CONVERSATIONS
     ========================================================= */

  const filteredConversations =
    conversations.filter(
      (conversation) =>
        conversation.title
          .toLowerCase()
          .includes(
            searchQuery
              .toLowerCase()
          )
    );

  /* =========================================================
     UI
     ========================================================= */

  return (
    <div className="relative isolate flex h-screen overflow-hidden bg-[#08060f] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-40 h-[32rem] w-[32rem] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute right-[-8rem] top-[18%] h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/10 blur-[130px]" />
        <div className="absolute bottom-[-14rem] left-[35%] h-[30rem] w-[30rem] rounded-full bg-indigo-500/15 blur-[130px]" />
      </div>

      {/* =====================================================
          SIDEBAR
          ===================================================== */}

      <aside className="flex w-64 shrink-0 flex-col border-r border-white/[0.12] bg-white/[0.035] shadow-[inset_-1px_0_0_rgba(255,255,255,0.025)] backdrop-blur-3xl">

        <div className="p-3">

          <button
            onClick={newChat}
            className="w-full rounded-xl border border-white/10 px-4 py-3 text-left text-sm hover:bg-violet-500/15"
          >
            ＋　New chat
          </button>

        </div>

        <div className="px-3 pb-3">

          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(
                event.target.value
              )
            }
            placeholder="Search chats..."
            className="w-full rounded-xl border border-white/[0.12] bg-white/[0.045] px-3 py-2.5 text-sm text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-violet-400/50 focus:bg-violet-500/[0.04]"
          />

        </div>

        <div className="flex-1 overflow-y-auto px-2">

          {loadingHistory ? (
            <div className="px-3 py-4 text-sm text-gray-500">
              Loading chats...
            </div>
          ) : filteredConversations.length ===
            0 ? (
            <div className="px-3 py-4 text-sm text-gray-500">
              No conversations
            </div>
          ) : (
            filteredConversations.map(
              (conversation) => (
                <div
                  key={
                    conversation.id
                  }
                  className={`group relative mb-1 flex items-center rounded-xl border border-transparent transition ${
                    conversationId ===
                    conversation.id
                      ? "border-violet-400/15 bg-violet-500/10 shadow-sm shadow-violet-950/10"
                      : "hover:bg-white/[0.04]"
                  }`}
                >

                  <button
                    onClick={() =>
                      openConversation(
                        conversation.id
                      )
                    }
                    className="min-w-0 flex-1 px-3 py-3 text-left text-sm"
                  >
                    <div className="truncate">
                      {
                        conversation.title
                      }
                    </div>
                  </button>

                  <button
                    onClick={() =>
                      setOpenMenuId(
                        openMenuId ===
                          conversation.id
                          ? null
                          : conversation.id
                      )
                    }
                    className="mr-2 rounded-md px-2 py-1 text-gray-500 hover:bg-white/[0.07] hover:text-white"
                  >
                    ⋯
                  </button>

                  {openMenuId ===
                    conversation.id && (
                    <div className="absolute right-2 top-10 z-20 w-36 rounded-lg border border-white/[0.14] bg-[#171322]/75 backdrop-blur-3xl p-1 shadow-xl shadow-black/40">

                      <button
                        onClick={() =>
                          renameConversation(
                            conversation.id,
                            conversation.title
                          )
                        }
                        className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.07]"
                      >
                        Rename
                      </button>

                      <button
                        onClick={() =>
                          deleteConversation(
                            conversation.id
                          )
                        }
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-red-400 hover:bg-white/[0.07]"
                      >
                        Delete
                      </button>

                    </div>
                  )}

                </div>
              )
            )
          )}

        </div>

        <div className="border-t border-white/[0.09] bg-white/[0.02] p-4 text-xs text-slate-500">
          Omnix.AI
        </div>

      </aside>

      {/* =====================================================
          MAIN AREA
          ===================================================== */}

      <main className="flex min-w-0 flex-1 flex-col">

        {/* HEADER */}

        <header className="flex items-center justify-between border-b border-white/[0.09] bg-white/[0.025] px-6 py-4 backdrop-blur-2xl">

          <div>

            <h1 className="bg-gradient-to-r from-white via-violet-100 to-violet-300 bg-clip-text text-lg font-semibold tracking-tight text-transparent">
              Omnix.AI
            </h1>

            <p className="text-xs text-gray-500">
              Your personal AI assistant
            </p>

          </div>

          {uploadedDocuments.length >
            0 && (
            <div className="flex max-w-xl flex-wrap justify-end gap-2">

              {uploadedDocuments.map(
                (document) => (
                  <div
                    key={
                      document.id
                    }
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs"
                  >

                    <span>
                      📄
                    </span>

                    <span className="max-w-40 truncate">
                      {document.name}
                    </span>

                    <button
                      onClick={() =>
                        removeDocument(
                          document.id
                        )
                      }
                      disabled={
                        uploading ||
                        loading
                      }
                      className="text-gray-500 hover:text-red-400"
                      title="Remove document"
                    >
                      ×
                    </button>

                  </div>
                )
              )}

            </div>
          )}

        </header>

        {/* ===================================================
            CHAT
            =================================================== */}

        <div className="flex-1 overflow-y-auto">

          {messages.length ===
          0 ? (

            <div className="flex h-full items-center justify-center px-4">

              <div className="w-full max-w-2xl text-center">

                <h2 className="mb-3 bg-gradient-to-r from-white via-violet-100 to-violet-300 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
                  How can I help you?
                </h2>

                <p className="text-slate-500">
                  Ask anything or upload a document to use RAG.
                </p>

              </div>

            </div>

          ) : (

            <div className="mx-auto w-full max-w-3xl px-4 py-8">

              {messages.map(
                (msg, index) => {

                  const parsed =
                    msg.role ===
                    "assistant"
                      ? parseAssistantContent(
                          msg.content
                        )
                      : {
                          answer:
                            msg.content,
                          sources: [] as Source[],
                        };

                  return (
                    <div
                      key={index}
                      className={`mb-8 flex ${
                        msg.role ===
                        "user"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >

                      <div
                        className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                          msg.role ===
                          "user"
                            ? "bg-white/[0.045]"
                            : "bg-transparent"
                        }`}
                      >

                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-200/70">
                          {msg.role ===
                          "user"
                            ? "You"
                            : "Omnix.AI"}
                        </div>

                        {msg.role ===
                          "assistant" &&
                        msg.content ===
                          "" &&
                        loading ? (

                          <div className="text-gray-400">
                            Thinking...
                          </div>

                        ) : (

                          <>
                            {/* =================================
                                AI ANSWER
                                ================================= */}

                            <div className="prose prose-invert max-w-none leading-7 text-gray-200">

                              <ReactMarkdown
                                remarkPlugins={[
                                  remarkGfm,
                                ]}
                                components={{
                                  code({
                                    className,
                                    children,
                                    ...props
                                  }) {
                                    const match =
                                      /language-(\w+)/.exec(
                                        className ||
                                          ""
                                      );

                                    const code =
                                      String(
                                        children
                                      ).replace(
                                        /\n$/,
                                        ""
                                      );

                                    return match ? (
                                      <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#111111]">

                                        <div className="flex items-center justify-between border-b border-white/10 bg-[#1a1a1a] px-4 py-2">

                                          <span className="text-xs text-gray-400">
                                            {
                                              match[1]
                                            }
                                          </span>

                                          <button
                                            onClick={() =>
                                              navigator.clipboard.writeText(
                                                code
                                              )
                                            }
                                            className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-violet-500/15 hover:text-white"
                                          >
                                            Copy
                                          </button>

                                        </div>

                                        <pre className="overflow-x-auto p-4 text-sm leading-6">

                                          <code
                                            {...props}
                                          >
                                            {
                                              code
                                            }
                                          </code>

                                        </pre>

                                      </div>
                                    ) : (
                                      <code
                                        {...props}
                                        className="rounded bg-white/[0.045] px-1.5 py-0.5 text-sm text-gray-200"
                                      >
                                        {
                                          children
                                        }
                                      </code>
                                    );
                                  },
                                }}
                              >
                                {
                                  parsed.answer
                                }
                              </ReactMarkdown>

                            </div>

                            {/* =================================
                                RAG SOURCES CARD
                                ================================= */}

                            {parsed.sources.length > 0 && (
  <div className="mt-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-3">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-300">
      <span>📚</span>

      <span>
        Sources
      </span>
    </div>

    <div className="space-y-2">
      {parsed.sources.map(
        (
          source,
          sourceIndex
        ) => {
          const pageText =
            source.pageNumber !== null
              ? ` — Page ${source.pageNumber}`
              : "";

          const sourceLabel =
            `${source.documentName}${pageText}`;

          const canOpen =
            Boolean(
              source.documentId
            );

          const sourceUrl =
            canOpen
              ? `/api/documents/${encodeURIComponent(
                  source.documentId
                )}/file${
                  source.pageNumber !==
                  null
                    ? `#page=${source.pageNumber}`
                    : ""
                }`
              : null;

          return (
            <button
              key={`${source.documentId || source.documentName}-${source.pageNumber}-${sourceIndex}`}
              type="button"
              disabled={!sourceUrl}
              onClick={() => {
                if (!sourceUrl) {
                  return;
                }

                window.open(
                  sourceUrl,
                  "_blank",
                  "noopener,noreferrer"
                );
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                sourceUrl
                  ? "cursor-pointer bg-[#242424] text-gray-300 hover:bg-[#303030] hover:text-white"
                  : "cursor-default bg-[#242424] text-gray-500"
              }`}
              title={
                sourceUrl
                  ? `Open ${sourceLabel}`
                  : sourceLabel
              }
            >
              <span className="text-slate-500">
                📄
              </span>

              <span className="min-w-0 flex-1 truncate">
                {sourceLabel}
              </span>

              {sourceUrl && (
                <span className="shrink-0 text-xs text-gray-500">
                  ↗
                </span>
              )}
            </button>
          );
        }
      )}
    </div>
  </div>
)}

                          </>

                        )}

                        {/* =====================================
                            MESSAGE ACTIONS
                            ===================================== */}

                        {msg.content && (
                          <div className="mt-2 flex items-center gap-2">

                            {msg.role ===
                            "user" ? (

                              <button
                                onClick={() =>
                                  startEditingMessage(
                                    index
                                  )
                                }
                                disabled={
                                  loading ||
                                  actionLoading ||
                                  editingIndex !==
                                    null
                                }
                                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-violet-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                title="Edit message"
                              >
                                ✏️ Edit
                              </button>

                            ) : (

                              <>

                                <button
                                onClick={() => speakResponse(msg.content)}
                                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-violet-500/15 hover:text-white"
                                title="Read response aloud"
                              >
                                🔊 Listen
                              </button>
                              <button
                                onClick={stopSpeaking}
                                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-violet-500/15 hover:text-white"
                                title="Stop spoken response"
                              >
                                ⏹ Stop
                              </button>

                              <button
                                  onClick={() =>
                                    navigator.clipboard.writeText(
                                      msg.content
                                    )
                                  }
                                  disabled={
                                    loading ||
                                    actionLoading ||
                                    msg.content ===
                                      ""
                                  }
                                  className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-violet-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                  title="Copy response"
                                >
                                  📋 Copy
                                </button>

                                {index ===
                                  messages.findLastIndex(
                                    (
                                      item
                                    ) =>
                                      item.role ===
                                      "assistant"
                                  ) && (

                                  <button
                                    onClick={() =>
                                      regenerateMessage()
                                    }
                                    disabled={
                                      loading ||
                                      actionLoading
                                    }
                                    className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-violet-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Regenerate response"
                                  >
                                    🔄 Regenerate
                                  </button>

                                )}

                              </>

                            )}

                          </div>
                        )}

                      </div>

                    </div>
                  );
                }
              )}

            </div>

          )}

        </div>

        {/* ===================================================
            INPUT AREA
            =================================================== */}

        <div className="border-t border-white/10 bg-white/[0.04] p-4">

          <div className="mx-auto max-w-3xl">

            {editingIndex !==
              null && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm">

                <span className="text-gray-400">
                  Editing message
                </span>

                <button
                  onClick={
                    cancelEditing
                  }
                  className="text-gray-500 hover:text-white"
                >
                  Cancel
                </button>

              </div>
            )}

            {uploadedDocuments.length >
              0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">

                {uploadedDocuments.map(
                  (document) => (
                    <div
                      key={
                        document.id
                      }
                      className="flex shrink-0 items-center gap-2 rounded-lg bg-violet-500/15 px-3 py-2 text-xs text-gray-300"
                    >

                      <span>
                        📄
                      </span>

                      <span className="max-w-40 truncate">
                        {
                          document.name
                        }
                      </span>

                      <button
                        onClick={() =>
                          removeDocument(
                            document.id
                          )
                        }
                        className="text-gray-500 hover:text-red-400"
                      >
                        ×
                      </button>

                    </div>
                  )
                )}

              </div>
            )}

            <div className="rounded-[28px] border border-white/[0.16] bg-white/[0.055] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_70px_rgba(0,0,0,0.42)] backdrop-blur-3xl transition focus-within:border-violet-300/40 focus-within:bg-white/[0.075] focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_16px_70px_rgba(0,0,0,0.42)]">

              <textarea
                value={
                  message +
                  (interimTranscript
                    ? `${message.trim() ? " " : ""}${interimTranscript}`
                    : "")
                }
                onChange={(event) => {
                  setMessage(event.target.value);
                  setInterimTranscript("");
                }}
                onKeyDown={
                  handleKeyDown
                }
                placeholder={
                  editingIndex !==
                  null
                    ? "Edit your message..."
                    : "Message Omnix.AI..."
                }
                rows={1}
                disabled={
                  loading ||
                  actionLoading
                }
                className="max-h-40 min-h-12 w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-6 text-white outline-none placeholder:text-slate-500"
              />

              <div className="flex items-center justify-between gap-2 px-1 pb-1">

                <div className="flex items-center gap-2">

                  {/* FILE UPLOAD */}

                  <label className="cursor-pointer rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300 transition hover:border-violet-400/30 hover:bg-violet-500/10 hover:text-white">

                    {uploading
                      ? "Uploading..."
                      : "📎 Attach"}

                    <input
                      type="file"
                      className="hidden"
                      accept=".pdf,.txt,.docx,.csv,.xlsx,.pptx,.jpg,.jpeg,.png,.webp"
                      onChange={
                        uploadPDF
                      }
                      disabled={
                        uploading ||
                        loading
                      }
                    />

                  </label>

                  <button
                    type="button"
                    onClick={startVoiceInput}
                    disabled={loading || uploading || isListening || editingIndex !== null}
                    className="rounded-full px-3 py-2 text-sm text-slate-300 transition hover:bg-violet-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    title={isListening ? "Listening..." : "Speak your message"}
                    aria-label="Start voice input"
                  >
                    {isListening ? "🎙️" : "🎤 Mic"}
                  </button>

                </div>

                <button
                  onClick={() => {
                    if (
                      editingIndex !==
                      null
                    ) {
                      editMessage();
                    } else {
                      sendMessage();
                    }
                  }}
                  disabled={
                    !message.trim() ||
                    loading ||
                    actionLoading
                  }
                  className="rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {editingIndex !==
                  null
                    ? "Save"
                    : "Send"}
                </button>

              </div>

            </div>

            <p className="mt-2 text-center text-xs text-gray-600">
              Omnix.AI can make mistakes. Check important information.
            </p>

          </div>

        </div>

      </main>

    </div>
  );
}