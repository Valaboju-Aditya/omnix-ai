"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type UploadedDocument = {
  id: string;
  name: string;
  pages?: number;
  createdAt: string;
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

  // Load conversation history
  useEffect(() => {
    loadConversations();
  }, []);

  // Restore last opened conversation
  useEffect(() => {
    const savedConversationId =
      localStorage.getItem("omnix-conversation-id");

    if (!savedConversationId) {
      return;
    }

    fetch(`/api/conversations/${savedConversationId}`)
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

        const loadedDocuments: UploadedDocument[] =
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
        setUploadedDocuments(loadedDocuments);
        setConversationId(savedConversationId);
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

      const loadedDocuments: UploadedDocument[] =
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
      setUploadedDocuments(loadedDocuments);
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

    const trimmedTitle = newTitle.trim();

    if (!trimmedTitle) {
      alert("Chat name cannot be empty.");
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to rename chat"
        );
      }

      setConversations((previous) =>
        previous.map((conversation) =>
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

      alert("Failed to rename chat.");
    }
  }

  async function deleteConversation(id: string) {
    setOpenMenuId(null);

    const conversation =
      conversations.find(
        (item) => item.id === id
      );

    const confirmed = window.confirm(
      `Delete "${
        conversation?.title || "this chat"
      }"?\n\nThis will permanently delete the conversation and its messages.`
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to delete conversation"
        );
      }

      setConversations((previous) =>
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

      alert("Failed to delete chat.");
    }
  }

  // =========================================================
  // FILE UPLOAD - PDF + TXT + DOCX
  // =========================================================

  async function uploadPDF(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const fileName = file.name.toLowerCase();

    const isPDF =
      file.type === "application/pdf" ||
      fileName.endsWith(".pdf");

    const isTXT =
      file.type === "text/plain" ||
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

    // Validate all supported file types
    if (
  !isPDF &&
  !isTXT &&
  !isDOCX &&
  !isCSV &&
  !isXLSX
) {
  alert(
    "Please select a PDF, TXT, DOCX, CSV, or XLSX file."
  );

  event.target.value = "";
  return;
}

    try {
      setUploading(true);

      const formData = new FormData();

      formData.append("file", file);

      // Attach to current conversation if available
      if (conversationId) {
        formData.append(
          "conversationId",
          conversationId
        );
      }

      const response = await fetch(
        "/api/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "File upload failed"
        );
      }

      // If backend created a new conversation,
      // save its ID immediately.
      if (data.conversationId) {
        setConversationId(data.conversationId);

        localStorage.setItem(
          "omnix-conversation-id",
          data.conversationId
        );
      }

      // Add uploaded file to UI
      setUploadedDocuments((previous) => [
        ...previous,
        {
          id: data.documentId,
          name: data.fileName,
          pages: data.pages,
          createdAt:
            new Date().toISOString(),
        },
      ]);

      // Refresh sidebar conversations
      await loadConversations();

    } catch (error) {
      console.error(
        "File upload error:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to upload file. Please try again."
      );
    } finally {
      setUploading(false);

      // Allow selecting the same file again
      event.target.value = "";
    }
  }

  // =========================================================
  // DELETE UPLOADED DOCUMENT
  // =========================================================

  async function removeUploadedDocument(
    id: string
  ) {
    try {
      const response = await fetch(
        `/api/documents/${id}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to delete document"
        );
      }

      setUploadedDocuments((previous) =>
        previous.filter(
          (document) => document.id !== id
        )
      );

      await loadConversations();

    } catch (error) {
      console.error(
        "Delete document error:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete document."
      );
    }
  }

  // =========================================================
  // REGENERATE LATEST ASSISTANT RESPONSE
  // =========================================================

  async function regenerateMessage() {
    if (
      !conversationId ||
      loading ||
      actionLoading
    ) {
      return;
    }

    const lastAssistantIndex =
      messages.findLastIndex(
        (item) => item.role === "assistant"
      );

    if (lastAssistantIndex === -1) {
      return;
    }

    const messagesForAI =
      messages.slice(0, lastAssistantIndex);

    setActionLoading(true);

    try {
      setMessages(messagesForAI);

      const response = await fetch(
        "/api/chat/actions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId,
            messages: messagesForAI,
            mode: "regenerate",
          }),
        }
      );

      if (!response.ok || !response.body) {
        let errorMessage =
          "Failed to regenerate response";

        try {
          const errorData =
            await response.json();

          if (errorData.error) {
            errorMessage =
              errorData.error;
          }
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(errorMessage);
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let assistantResponse = "";

      setMessages([
        ...messagesForAI,
        {
          role: "assistant",
          content: "",
        },
      ]);

      while (true) {
        const { done, value } =
          await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(value, {
            stream: true,
          });

        assistantResponse += chunk;

        setMessages([
          ...messagesForAI,
          {
            role: "assistant",
            content: assistantResponse,
          },
        ]);
      }

      const finalChunk =
        decoder.decode();

      if (finalChunk) {
        assistantResponse += finalChunk;

        setMessages([
          ...messagesForAI,
          {
            role: "assistant",
            content: assistantResponse,
          },
        ]);
      }

      await loadConversations();

    } catch (error) {
      console.error(
        "Regenerate error:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to regenerate response."
      );
    } finally {
      setActionLoading(false);
    }
  }

  // =========================================================
  // START EDITING USER MESSAGE
  // =========================================================

  function startEditingMessage(
    index: number
  ) {
    const selectedMessage = messages[index];

    if (!selectedMessage) {
      return;
    }

    if (selectedMessage.role !== "user") {
      return;
    }

    if (loading || actionLoading) {
      return;
    }

    setEditingIndex(index);
    setMessage(selectedMessage.content);
  }

  // =========================================================
  // SAVE EDITED USER MESSAGE
  // =========================================================

  async function saveEditedMessage() {
    if (
      editingIndex === null ||
      !conversationId ||
      !message.trim() ||
      actionLoading
    ) {
      return;
    }

    const editIndex = editingIndex;

    const newUserMessage: Message = {
      role: "user",
      content: message.trim(),
    };

    const messagesBeforeEdit =
      messages.slice(0, editIndex);

    const newMessages = [
      ...messagesBeforeEdit,
      newUserMessage,
    ];

    setActionLoading(true);
    setEditingIndex(null);
    setMessage("");

    try {
      setMessages(newMessages);

      const response = await fetch(
        "/api/chat/actions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            conversationId,
            messages: newMessages,
            mode: "edit",
            editIndex,
          }),
        }
      );

      if (!response.ok || !response.body) {
        let errorMessage =
          "Failed to edit message";

        try {
          const errorData =
            await response.json();

          if (errorData.error) {
            errorMessage =
              errorData.error;
          }
        } catch {
          // Ignore JSON parsing error
        }

        throw new Error(errorMessage);
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let assistantResponse = "";

      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "",
        },
      ]);

      while (true) {
        const { done, value } =
          await reader.read();

        if (done) {
          break;
        }

        const chunk =
          decoder.decode(value, {
            stream: true,
          });

        assistantResponse += chunk;

        setMessages([
          ...newMessages,
          {
            role: "assistant",
            content: assistantResponse,
          },
        ]);
      }

      const finalChunk =
        decoder.decode();

      if (finalChunk) {
        assistantResponse += finalChunk;

        setMessages([
          ...newMessages,
          {
            role: "assistant",
            content: assistantResponse,
          },
        ]);
      }

      await loadConversations();

    } catch (error) {
      console.error(
        "Edit message error:",
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : "Failed to edit message."
      );
    } finally {
      setActionLoading(false);
    }
  }

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  async function sendMessage() {
  if (
    !message.trim() ||
    loading ||
    actionLoading
  ) {
    return;
  }

  const userMessage: Message = {
    role: "user",
    content: message.trim(),
  };

  const updatedMessages: Message[] = [
    ...messages,
    userMessage,
  ];

  setMessages([
    ...updatedMessages,
    {
      role: "assistant",
      content: "",
    },
  ]);

  setMessage("");
  setLoading(true);

  try {
    console.log(
      "FRONTEND: Sending message..."
    );

    const response = await fetch(
      "/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
          conversationId,
        }),
      }
    );

    console.log(
      "FRONTEND: Response received:",
      response.status
    );

    if (!response.ok) {
      let errorMessage =
        "Something went wrong";

      try {
        const errorData =
          await response.json();

        if (errorData.error) {
          errorMessage =
            errorData.error;
        }
      } catch {
        // Ignore JSON parsing error
      }

      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error(
        "No response stream received from server."
      );
    }

    console.log(
      "FRONTEND: Response stream available"
    );

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder("utf-8");

    let assistantResponse = "";

    while (true) {
      const {
        done,
        value,
      } = await reader.read();

      if (done) {
        console.log(
          "FRONTEND: Stream finished"
        );

        break;
      }

      const chunk =
        decoder.decode(value, {
          stream: true,
        });

      console.log(
        "FRONTEND: Received chunk:",
        chunk
      );

      if (!chunk) {
        continue;
      }

      assistantResponse += chunk;

      setMessages((previous) => {
  const updated = [...previous];

  const assistantIndex =
    updated.findLastIndex(
      (item) => item.role === "assistant"
    );

  if (assistantIndex !== -1) {
    updated[assistantIndex] = {
      role: "assistant",
      content: assistantResponse,
    };
  }

  return updated;
});
    }

    // Flush decoder
    const finalChunk =
      decoder.decode();

    if (finalChunk) {
      assistantResponse +=
        finalChunk;

      setMessages((previous) => {
  const updated = [...previous];

  const assistantIndex =
    updated.findLastIndex(
      (item) => item.role === "assistant"
    );

  if (assistantIndex !== -1) {
    updated[assistantIndex] = {
      role: "assistant",
      content: assistantResponse,
    };
  }

  return updated;
});
    }

    console.log(
      "FRONTEND: Final response:",
      assistantResponse
    );

    if (!assistantResponse) {
      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content:
            "The AI returned an empty response.",
        },
      ]);
    }

    // Refresh sidebar
    await loadConversations();

    // Capture newly created conversation ID
    if (!conversationId) {
      const historyResponse =
        await fetch(
          "/api/conversations"
        );

      if (historyResponse.ok) {
        const history =
          await historyResponse.json();

        setConversations(history);

        if (history.length > 0) {
          const newestConversation =
            history[0];

          setConversationId(
            newestConversation.id
          );

          localStorage.setItem(
            "omnix-conversation-id",
            newestConversation.id
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "FRONTEND CHAT ERROR:",
      error
    );

    setMessages([
      ...updatedMessages,
      {
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Failed to receive response from Omnix.AI.",
      },
    ]);
  } finally {
    setLoading(false);
  }
}

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      if (editingIndex !== null) {
        saveEditedMessage();
      } else {
        sendMessage();
      }
    }
  }

  function cancelEditing() {
    setEditingIndex(null);
    setMessage("");
  }

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

  const filteredConversations =
    conversations.filter(
      (conversation) =>
        conversation.title
          .toLowerCase()
          .includes(
            searchQuery.toLowerCase()
          )
    );

  return (
    <main className="flex h-screen bg-[#212121] text-white">

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside className="hidden w-64 flex-col bg-[#171717] p-3 md:flex">

        <button
          onClick={newChat}
          className="mb-4 rounded-lg border border-gray-700 px-4 py-3 text-left hover:bg-[#2a2a2a]"
        >
          + New Chat
        </button>

        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) =>
            setSearchQuery(e.target.value)
          }
          className="mb-3 w-full rounded-lg border border-gray-700 bg-[#212121] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-gray-500"
        />

        <div className="mb-3 px-2 text-sm text-gray-400">
          Recent
        </div>

        <div className="flex-1 overflow-y-auto">

          {loadingHistory ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              No conversations yet
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">
              No chats found
            </div>
          ) : (
            filteredConversations.map(
              (conversation) => (
                <div
                  key={conversation.id}
                  className={`group relative mb-1 flex items-center rounded-lg hover:bg-[#2a2a2a] ${
                    conversation.id ===
                    conversationId
                      ? "bg-[#2a2a2a]"
                      : ""
                  }`}
                >

                  <button
                    onClick={() =>
                      openConversation(
                        conversation.id
                      )
                    }
                    className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                  >
                    {conversation.title}
                  </button>

                  <button
                    onClick={(event) => {
                      event.stopPropagation();

                      setOpenMenuId(
                        openMenuId ===
                          conversation.id
                          ? null
                          : conversation.id
                      );
                    }}
                    className="mr-1 rounded-md px-2 py-1 text-gray-400 opacity-0 hover:bg-[#3a3a3a] hover:text-white group-hover:opacity-100"
                    title="Chat options"
                  >
                    ⋮
                  </button>

                  {openMenuId ===
                    conversation.id && (
                    <div className="absolute right-1 top-9 z-50 w-36 overflow-hidden rounded-lg border border-gray-700 bg-[#2a2a2a] shadow-xl">

                      <button
                        onClick={() =>
                          renameConversation(
                            conversation.id,
                            conversation.title
                          )
                        }
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#3a3a3a]"
                      >
                        ✏️ Rename
                      </button>

                      <button
                        onClick={() =>
                          deleteConversation(
                            conversation.id
                          )
                        }
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-[#3a3a3a]"
                      >
                        🗑️ Delete
                      </button>

                    </div>
                  )}

                </div>
              )
            )
          )}

        </div>

        <button className="rounded-lg px-3 py-3 text-left text-sm hover:bg-[#2a2a2a]">
          ⚙ Settings
        </button>

      </aside>

      {/* =====================================================
          MAIN
      ===================================================== */}

      <section className="flex flex-1 flex-col">

        {/* HEADER */}

        <header className="flex h-14 items-center border-b border-gray-700 px-5">

          <h1 className="text-lg font-semibold">
            Omnix
            <span className="text-gray-400">
              .AI
            </span>
          </h1>

          <div className="ml-4 rounded-md bg-[#2f2f2f] px-3 py-1 text-xs text-gray-300">
            Qwen3 1.7B
          </div>

          <button className="ml-auto rounded-lg px-3 py-2 hover:bg-[#2a2a2a]">
            ⚙
          </button>

        </header>

        {/* =====================================================
            CHAT AREA
        ===================================================== */}

        <div className="flex-1 overflow-y-auto">

          {messages.length === 0 ? (

            <div className="flex h-full items-center justify-center px-4">

              <div className="text-center">

                <div className="mb-4 text-4xl font-bold">
                  Omnix.AI
                </div>

                <p className="text-gray-400">
                  Your personal AI assistant
                </p>

                <div className="mt-8 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">

                  <button
                    onClick={() =>
                      setMessage(
                        "Explain machine learning simply"
                      )
                    }
                    className="rounded-xl border border-gray-700 p-4 text-left hover:bg-[#2a2a2a]"
                  >
                    <div className="font-medium">
                      Explain something
                    </div>

                    <div className="mt-1 text-sm text-gray-500">
                      Learn a concept simply
                    </div>
                  </button>

                  <button
                    onClick={() =>
                      setMessage(
                        "Write a Python program to reverse a string"
                      )
                    }
                    className="rounded-xl border border-gray-700 p-4 text-left hover:bg-[#2a2a2a]"
                  >
                    <div className="font-medium">
                      Help with coding
                    </div>

                    <div className="mt-1 text-sm text-gray-500">
                      Write or explain code
                    </div>
                  </button>

                </div>

              </div>

            </div>

          ) : (

            <div className="mx-auto w-full max-w-3xl px-4 py-8">

              {messages.map(
                (msg, index) => (

                  <div
                    key={index}
                    className={`mb-8 flex ${
                      msg.role === "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >

                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                        msg.role === "user"
                          ? "bg-[#2f2f2f]"
                          : "bg-transparent"
                      }`}
                    >

                      <div className="mb-2 text-xs font-semibold text-gray-400">
                        {msg.role ===
                        "user"
                          ? "You"
                          : "Omnix.AI"}
                      </div>

                      {msg.role ===
                        "assistant" &&
                      msg.content === "" &&
                      loading ? (

                        <div className="text-gray-400">
                          Thinking...
                        </div>

                      ) : (

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

                                  <div className="my-4 overflow-hidden rounded-xl border border-gray-700 bg-[#111111]">

                                    <div className="flex items-center justify-between border-b border-gray-700 bg-[#1a1a1a] px-4 py-2">

                                      <span className="text-xs text-gray-400">
                                        {match[1]}
                                      </span>

                                      <button
                                        onClick={() =>
                                          navigator.clipboard.writeText(
                                            code
                                          )
                                        }
                                        className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-[#2a2a2a] hover:text-white"
                                      >
                                        Copy
                                      </button>

                                    </div>

                                    <pre className="overflow-x-auto p-4 text-sm leading-6">

                                      <code
                                        {...props}
                                      >
                                        {code}
                                      </code>

                                    </pre>

                                  </div>

                                ) : (

                                  <code
                                    {...props}
                                    className="rounded bg-[#2f2f2f] px-1.5 py-0.5 text-sm text-gray-200"
                                  >
                                    {children}
                                  </code>

                                );
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>

                        </div>

                      )}

                      {/* MESSAGE ACTIONS */}

                      {msg.content &&
                        !loading &&
                        !actionLoading && (

                        <div className="mt-2 flex items-center gap-2">

                          {msg.role === "user" ? (

                            <button
                              onClick={() =>
                                startEditingMessage(
                                  index
                                )
                              }
                              disabled={
                                editingIndex !== null
                              }
                              className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-[#2a2a2a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              title="Edit message"
                            >
                              ✏️ Edit
                            </button>

                          ) : (

                            <>
                              <button
                                onClick={() =>
                                  navigator.clipboard.writeText(
                                    msg.content
                                  )
                                }
                                className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-[#2a2a2a] hover:text-white"
                                title="Copy response"
                              >
                                📋 Copy
                              </button>

                              {index ===
                                messages.findLastIndex(
                                  (item) =>
                                    item.role ===
                                    "assistant"
                                ) && (
                                <button
                                  onClick={
                                    regenerateMessage
                                  }
                                  disabled={
                                    !conversationId
                                  }
                                  className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-[#2a2a2a] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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

                )
              )}

            </div>

          )}

        </div>

        {/* =====================================================
            INPUT AREA
        ===================================================== */}

        <div className="mx-auto w-full max-w-3xl px-4 pb-6">

          {editingIndex !== null && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-gray-700 bg-[#2f2f2f] px-3 py-2 text-sm">

              <span className="text-gray-400">
                ✏️ Editing your message
              </span>

              <button
                onClick={cancelEditing}
                className="text-gray-400 hover:text-white"
              >
                Cancel
              </button>

            </div>
          )}

          {/* =====================================================
              ATTACHED FILES
          ===================================================== */}

          {uploadedDocuments.length > 0 && (

            <div className="mb-3 flex flex-wrap gap-2">

              {uploadedDocuments.map(
                (document) => (

                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-700 bg-[#2f2f2f] px-3 py-2"
                  >

                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-lg">
                      📄
                    </div>

                    <div className="min-w-0">

                      <div className="max-w-[220px] truncate text-sm font-medium text-white">
                        {document.name}
                      </div>

                      <div className="text-xs text-gray-500">

                        {document.name
                          .toLowerCase()
                          .endsWith(".docx")
                          ? "DOCX"
                          : document.name
                              .toLowerCase()
                              .endsWith(".txt")
                            ? "TXT"
                            : "PDF"}

                        {document.pages
                          ? ` • ${document.pages} pages`
                          : ""}

                        {" • Attached"}

                      </div>

                    </div>

                    <button
                      onClick={() =>
                        removeUploadedDocument(
                          document.id
                        )
                      }
                      className="ml-1 rounded-md px-2 py-1 text-gray-400 hover:bg-[#424242] hover:text-white"
                      title="Remove attachment"
                    >
                      ✕
                    </button>

                  </div>

                )
              )}

            </div>

          )}

          {/* =====================================================
              MESSAGE BOX
          ===================================================== */}

          <div className="flex items-end rounded-2xl border border-gray-600 bg-[#2f2f2f] p-2">

            {/* FILE UPLOAD */}

            <label
              className={`cursor-pointer rounded-lg p-3 text-gray-300 hover:bg-[#424242] ${
                uploading ||
                editingIndex !== null
                  ? "pointer-events-none opacity-50"
                  : ""
              }`}
              title="Upload PDF, TXT, or DOCX"
            >

              {uploading ? "⏳" : "📎"}

              <input
                type="file"
                accept=".pdf,.txt,.docx,.csv,.xlsx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={uploadPDF}
                className="hidden"
              />

            </label>

            {/* TEXTAREA */}

            <textarea
              value={message}
              onChange={(e) =>
                setMessage(e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder={
                editingIndex !== null
                  ? "Edit your message..."
                  : "Ask Omnix.AI anything..."
              }
              rows={1}
              className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-3 py-3 text-white outline-none placeholder:text-gray-500"
            />

            {/* CANCEL EDIT */}

            {editingIndex !== null && (

              <button
                onClick={cancelEditing}
                disabled={actionLoading}
                className="mr-1 rounded-lg px-3 py-3 text-sm text-gray-400 hover:bg-[#424242] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                title="Cancel edit"
              >
                Cancel
              </button>

            )}

            {/* SEND / SAVE EDIT */}

            <button
              onClick={
                editingIndex !== null
                  ? saveEditedMessage
                  : sendMessage
              }
              disabled={
                !message.trim() ||
                loading ||
                actionLoading
              }
              className="rounded-lg bg-white px-4 py-3 font-medium text-black disabled:cursor-not-allowed disabled:opacity-30"
              title={
                editingIndex !== null
                  ? "Save edited message"
                  : "Send message"
              }
            >
              {loading || actionLoading
                ? "..."
                : editingIndex !== null
                  ? "✓"
                  : "➤"}
            </button>

          </div>

          <p className="mt-2 text-center text-xs text-gray-500">
            Omnix.AI can make mistakes. Check important information.
          </p>

        </div>

      </section>

    </main>
  );
}