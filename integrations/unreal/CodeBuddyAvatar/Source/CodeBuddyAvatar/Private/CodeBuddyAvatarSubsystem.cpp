#include "CodeBuddyAvatarSubsystem.h"

#include "Async/Async.h"
#include "Components/AudioComponent.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformMisc.h"
#include "IWebSocket.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/Base64.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Sound/SoundWaveProcedural.h"
#include "WebSocketsModule.h"

DEFINE_LOG_CATEGORY_STATIC(LogCodeBuddyAvatar, Log, All);

namespace
{
constexpr int32 ProtocolVersion = 1;
constexpr int32 ProtocolMaxChunkBytes = 48 * 1024;
constexpr uint64 MaxTextMessageBytes = 2 * 1024 * 1024;

TSharedPtr<FJsonObject> ObjectField(
    const TSharedPtr<FJsonObject>& Object,
    const TCHAR* Name)
{
    if (!Object.IsValid() || !Object->HasTypedField<EJson::Object>(Name))
    {
        return nullptr;
    }
    return Object->GetObjectField(Name);
}

bool IntegerField(
    const TSharedPtr<FJsonObject>& Object,
    const TCHAR* Name,
    int64& OutValue)
{
    double Number = 0.0;
    if (!Object.IsValid() || !Object->TryGetNumberField(Name, Number) ||
        !FMath::IsFinite(Number))
    {
        return false;
    }
    if (Number < static_cast<double>(MIN_int64) ||
        Number > static_cast<double>(MAX_int64))
    {
        return false;
    }
    const int64 Integer = static_cast<int64>(Number);
    if (static_cast<double>(Integer) != Number)
    {
        return false;
    }
    OutValue = Integer;
    return true;
}

FString StringField(
    const TSharedPtr<FJsonObject>& Object,
    const TCHAR* Name)
{
    FString Result;
    if (Object.IsValid())
    {
        Object->TryGetStringField(Name, Result);
    }
    return Result;
}
}

void UCodeBuddyAvatarSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    AuthenticationToken = FPlatformMisc::GetEnvironmentVariable(TEXT("CODEBUDDY_AVATAR_TOKEN"));
    HeartbeatSeconds = FMath::Clamp(HeartbeatSeconds, 5.0f, 30.0f);
    ReconnectInitialSeconds = FMath::Clamp(ReconnectInitialSeconds, 0.5f, 30.0f);
    ReconnectMaxSeconds = FMath::Clamp(ReconnectMaxSeconds, ReconnectInitialSeconds, 120.0f);
    MaxWavBytes = FMath::Clamp(MaxWavBytes, 1024 * 1024, 64 * 1024 * 1024);
    NextReconnectAt = FPlatformTime::Seconds();
    if (bAutoConnect)
    {
        Connect();
    }
}

void UCodeBuddyAvatarSubsystem::Deinitialize()
{
    Disconnect();
    ResetPlaybackState();
    Super::Deinitialize();
}

void UCodeBuddyAvatarSubsystem::Tick(float DeltaTime)
{
    if (DeltaTime > 0.0f)
    {
        const float InstantFps = FMath::Clamp(1.0f / DeltaTime, 0.0f, 240.0f);
        SmoothedFps = SmoothedFps <= 0.0f
            ? InstantFps
            : FMath::Lerp(SmoothedFps, InstantFps, 0.08f);
    }

    const double Now = FPlatformTime::Seconds();
    if (bRegistered && Now - LastHeartbeatAt >= HeartbeatSeconds)
    {
        SendStatus();
    }
    if (bAutoConnect && !Socket.IsValid() && !bManualDisconnect &&
        !bAuthenticationBlocked && Now >= NextReconnectAt)
    {
        Connect();
    }
}

TStatId UCodeBuddyAvatarSubsystem::GetStatId() const
{
    RETURN_QUICK_DECLARE_CYCLE_STAT(UCodeBuddyAvatarSubsystem, STATGROUP_Tickables);
}

bool UCodeBuddyAvatarSubsystem::IsTickable() const
{
    return !IsTemplate() && (bAutoConnect || Socket.IsValid());
}

void UCodeBuddyAvatarSubsystem::Connect()
{
    if (Socket.IsValid())
    {
        return;
    }
    if (!GatewayUrl.StartsWith(TEXT("ws://")) && !GatewayUrl.StartsWith(TEXT("wss://")))
    {
        SetPhase(ECodeBuddyAvatarPhase::Error, TEXT("GatewayUrl must use ws:// or wss://."));
        OnProtocolError.Broadcast(TEXT("Refusing a non-WebSocket GatewayUrl."));
        return;
    }

    bManualDisconnect = false;
    bAuthenticationBlocked = false;
    bRegistered = false;
    bSyncPending = false;
    const uint64 Generation = ++ConnectionGeneration;
    Socket = FWebSocketsModule::Get().CreateWebSocket(GatewayUrl);
    Socket->SetTextMessageMemoryLimit(MaxTextMessageBytes);

    TWeakObjectPtr<UCodeBuddyAvatarSubsystem> WeakThis(this);
    Socket->OnConnected().AddLambda([WeakThis, Generation]()
    {
        AsyncTask(ENamedThreads::GameThread, [WeakThis, Generation]()
        {
            if (WeakThis.IsValid())
            {
                WeakThis->HandleSocketConnected(Generation);
            }
        });
    });
    Socket->OnClosed().AddLambda(
        [WeakThis, Generation](int32 StatusCode, const FString& Reason, bool bWasClean)
        {
            AsyncTask(
                ENamedThreads::GameThread,
                [WeakThis, Generation, StatusCode, Reason, bWasClean]()
                {
                    if (WeakThis.IsValid())
                    {
                        WeakThis->HandleSocketClosed(
                            Generation,
                            StatusCode,
                            Reason,
                            bWasClean);
                    }
                });
        });
    Socket->OnConnectionError().AddLambda([WeakThis, Generation](const FString& Error)
    {
        AsyncTask(ENamedThreads::GameThread, [WeakThis, Generation, Error]()
        {
            if (WeakThis.IsValid())
            {
                WeakThis->HandleSocketError(Generation, Error);
            }
        });
    });
    Socket->OnMessage().AddLambda([WeakThis, Generation](const FString& Message)
    {
        AsyncTask(ENamedThreads::GameThread, [WeakThis, Generation, Message]()
        {
            if (WeakThis.IsValid())
            {
                WeakThis->HandleSocketMessage(Generation, Message);
            }
        });
    });

    UE_LOG(LogCodeBuddyAvatar, Log, TEXT("Connecting renderer %s to %s"), *RendererId, *GatewayUrl);
    Socket->Connect();
}

void UCodeBuddyAvatarSubsystem::Disconnect()
{
    bManualDisconnect = true;
    bTransportConnected = false;
    bRegistered = false;
    bSyncPending = false;
    ++ConnectionGeneration;
    const TSharedPtr<IWebSocket> Previous = Socket;
    Socket.Reset();
    if (Previous.IsValid())
    {
        Previous->Close(1000, TEXT("Renderer shutdown"));
    }
    ResetPlaybackState();
    SetPhase(ECodeBuddyAvatarPhase::Unavailable, TEXT("Disconnected"));
    OnConnectionChanged.Broadcast(false, TEXT("Disconnected"));
}

void UCodeBuddyAvatarSubsystem::SetAuthenticationToken(const FString& Token)
{
    AuthenticationToken = Token.TrimStartAndEnd();
    bAuthenticationBlocked = false;
    bManualDisconnect = false;
    NextReconnectAt = FPlatformTime::Seconds();
}

void UCodeBuddyAvatarSubsystem::SetAudioDrivenAnimationReady(bool bReady)
{
    bAudioDrivenAnimationEnabled = bReady;
    if (bRegistered)
    {
        SendHello();
    }
}

void UCodeBuddyAvatarSubsystem::ReportMouthLatency(float LatencyMs)
{
    MouthLatencyMs = FMath::Clamp(LatencyMs, 0.0f, 5000.0f);
}

void UCodeBuddyAvatarSubsystem::StopPlayback()
{
    ResetPlaybackState();
    SetPhase(ECodeBuddyAvatarPhase::Ready, TEXT("Playback stopped locally"));
}

void UCodeBuddyAvatarSubsystem::HandleSocketConnected(uint64 Generation)
{
    if (Generation != ConnectionGeneration || !Socket.IsValid())
    {
        return;
    }
    bTransportConnected = true;
    OnConnectionChanged.Broadcast(true, TEXT("Transport connected; waiting for Gateway greeting"));
}

void UCodeBuddyAvatarSubsystem::HandleSocketClosed(
    uint64 Generation,
    int32 StatusCode,
    const FString& Reason,
    bool bWasClean)
{
    if (Generation != ConnectionGeneration)
    {
        return;
    }
    Socket.Reset();
    bTransportConnected = false;
    bRegistered = false;
    bSyncPending = false;
    ResetPlaybackState();
    const FString Detail = FString::Printf(
        TEXT("Socket closed (%d, %s, clean=%s)"),
        StatusCode,
        *Reason,
        bWasClean ? TEXT("true") : TEXT("false"));
    SetPhase(ECodeBuddyAvatarPhase::Unavailable, Detail);
    OnConnectionChanged.Broadcast(false, Detail);
    if (!bManualDisconnect && !bAuthenticationBlocked)
    {
        ScheduleReconnect();
    }
}

void UCodeBuddyAvatarSubsystem::HandleSocketError(uint64 Generation, const FString& Error)
{
    if (Generation != ConnectionGeneration)
    {
        return;
    }
    UE_LOG(LogCodeBuddyAvatar, Warning, TEXT("WebSocket connection error: %s"), *Error);
    OnProtocolError.Broadcast(Error);
}

void UCodeBuddyAvatarSubsystem::HandleSocketMessage(
    uint64 Generation,
    const FString& Message)
{
    if (Generation != ConnectionGeneration)
    {
        return;
    }
    HandleGatewayMessage(Message);
}

void UCodeBuddyAvatarSubsystem::HandleGatewayMessage(const FString& Message)
{
    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        OnProtocolError.Broadcast(TEXT("Gateway sent malformed JSON."));
        return;
    }

    const FString Type = StringField(Root, TEXT("type"));
    const TSharedPtr<FJsonObject> Payload = ObjectField(Root, TEXT("payload"));
    if (Type == TEXT("connected"))
    {
        const bool bAuthRequired = Payload.IsValid() &&
            Payload->HasTypedField<EJson::Boolean>(TEXT("authRequired")) &&
            Payload->GetBoolField(TEXT("authRequired"));
        if (bAuthRequired)
        {
            if (AuthenticationToken.IsEmpty())
            {
                FailAuthentication(
                    TEXT("Gateway authentication is required; provide CODEBUDDY_AVATAR_TOKEN."));
                return;
            }
            const TSharedRef<FJsonObject> Auth = MakeShared<FJsonObject>();
            Auth->SetStringField(TEXT("token"), AuthenticationToken);
            const TSharedRef<FJsonObject> Request = MakeShared<FJsonObject>();
            Request->SetStringField(TEXT("type"), TEXT("authenticate"));
            Request->SetObjectField(TEXT("payload"), Auth);
            SendJson(Request);
        }
        else
        {
            SendHello();
        }
        return;
    }
    if (Type == TEXT("authenticated"))
    {
        bool bCanRead = false;
        bool bCanWrite = false;
        bool bAdmin = false;
        if (Payload.IsValid() && Payload->HasTypedField<EJson::Array>(TEXT("scopes")))
        {
            for (const TSharedPtr<FJsonValue>& Scope : Payload->GetArrayField(TEXT("scopes")))
            {
                const FString Value = Scope.IsValid() ? Scope->AsString() : FString();
                bCanRead |= Value == TEXT("avatar:read");
                bCanWrite |= Value == TEXT("avatar:write");
                bAdmin |= Value == TEXT("admin");
            }
        }
        if ((!bCanRead || !bCanWrite) && !bAdmin)
        {
            FailAuthentication(TEXT("Avatar token lacks avatar:read and avatar:write scopes."));
            return;
        }
        SendHello();
        return;
    }
    if (Type == TEXT("avatar.renderer.ack"))
    {
        if (StringField(Payload, TEXT("kind")) == TEXT("hello"))
        {
            bRegistered = true;
            ReconnectAttempt = 0;
            bSyncPending = true;
            SendSync();
        }
        return;
    }
    if (Type == TEXT("avatar:sync"))
    {
        HandleSync(Payload);
        return;
    }
    if (Type == TEXT("avatar:event"))
    {
        if (!bRegistered || bSyncPending)
        {
            return;
        }
        HandleAvatarEvent(Payload);
        return;
    }
    if (Type == TEXT("error"))
    {
        const TSharedPtr<FJsonObject> ErrorObject = ObjectField(Root, TEXT("error"));
        const FString Code = StringField(ErrorObject, TEXT("code"));
        const FString ErrorMessage = StringField(ErrorObject, TEXT("message"));
        const FString Combined = Code.IsEmpty()
            ? ErrorMessage
            : FString::Printf(TEXT("%s: %s"), *Code, *ErrorMessage);
        if (Code == TEXT("UNAUTHORIZED") || Code == TEXT("FORBIDDEN") ||
            Code == TEXT("CONFIG_ERROR") || Code == TEXT("REMOTE_AUTH_REQUIRED"))
        {
            FailAuthentication(Combined);
        }
        else
        {
            OnProtocolError.Broadcast(Combined);
        }
    }
}

void UCodeBuddyAvatarSubsystem::HandleSync(const TSharedPtr<FJsonObject>& Payload)
{
    if (!Payload.IsValid())
    {
        OnProtocolError.Broadcast(TEXT("avatar:sync is missing its payload."));
        return;
    }

    int64 LatestSequence = -1;
    if (!IntegerField(Payload, TEXT("latestSequence"), LatestSequence))
    {
        OnProtocolError.Broadcast(TEXT("avatar:sync has no valid latestSequence."));
        return;
    }
    if (Payload->HasTypedField<EJson::Boolean>(TEXT("audioReplay")) &&
        Payload->GetBoolField(TEXT("audioReplay")))
    {
        OnProtocolError.Broadcast(TEXT("Refusing avatar:sync with audioReplay enabled."));
        return;
    }

    int64 ReplayedSequence = -1;
    if (Payload->HasTypedField<EJson::Array>(TEXT("events")))
    {
        for (const TSharedPtr<FJsonValue>& Value : Payload->GetArrayField(TEXT("events")))
        {
            const TSharedPtr<FJsonObject> Event =
                Value.IsValid() && Value->Type == EJson::Object ? Value->AsObject() : nullptr;
            int64 Sequence = -1;
            if (!Event.IsValid() || !IntegerField(Event, TEXT("sequence"), Sequence) ||
                Sequence <= ReplayedSequence || Sequence > LatestSequence)
            {
                OnProtocolError.Broadcast(TEXT("avatar:sync contains unordered events."));
                return;
            }
            ReplayedSequence = Sequence;
        }
    }

    ResetPlaybackState();
    IgnoredTurnIds.Reset();
    if (Payload->HasTypedField<EJson::Array>(TEXT("ignoredTurnIds")))
    {
        for (const TSharedPtr<FJsonValue>& Value : Payload->GetArrayField(TEXT("ignoredTurnIds")))
        {
            const FString TurnId = Value.IsValid() ? Value->AsString() : FString();
            if (!TurnId.IsEmpty())
            {
                IgnoredTurnIds.Add(TurnId);
            }
        }
    }
    LastSequence = LatestSequence;
    bSyncPending = false;
    SetPhase(ECodeBuddyAvatarPhase::Ready, TEXT("Synchronized without audio replay"));
    SendStatus();
}

void UCodeBuddyAvatarSubsystem::HandleAvatarEvent(const TSharedPtr<FJsonObject>& Event)
{
    const FString Type = StringField(Event, TEXT("type"));
    const FString TurnId = StringField(Event, TEXT("turnId"));
    int64 Sequence = -1;
    if (!Event.IsValid() || Type.IsEmpty() || TurnId.IsEmpty() ||
        !IntegerField(Event, TEXT("sequence"), Sequence))
    {
        OnProtocolError.Broadcast(TEXT("avatar:event is missing type, turnId or sequence."));
        return;
    }
    if (Sequence <= LastSequence)
    {
        return;
    }
    if (LastSequence >= 0 && Sequence != LastSequence + 1)
    {
        DroppedAudioChunks += IncomingAudio.Num();
        ResetPlaybackState();
        bSyncPending = true;
        OnProtocolError.Broadcast(TEXT("Avatar sequence gap detected; requesting a clean sync."));
        SendSync();
        return;
    }
    LastSequence = Sequence;

    if (IgnoredTurnIds.Contains(TurnId))
    {
        if (IsTerminalEvent(Type))
        {
            IgnoredTurnIds.Remove(TurnId);
        }
        return;
    }

    if (Type == TEXT("avatar.turn.started"))
    {
        if (!ActiveTurnId.IsEmpty() && ActiveTurnId != TurnId)
        {
            ResetPlaybackState();
        }
        ActiveTurnId = TurnId;
        const FCodeBuddyAvatarCue Cue = ParseCue(Event);
        OnPerformanceCue.Broadcast(TurnId, Cue);
        SetPhase(ECodeBuddyAvatarPhase::Ready, TEXT("Turn started"));
        return;
    }
    if (!ActiveTurnId.IsEmpty() && ActiveTurnId != TurnId)
    {
        return;
    }
    if (ActiveTurnId.IsEmpty())
    {
        ActiveTurnId = TurnId;
    }

    if (Type == TEXT("avatar.speech.prepared") || Type == TEXT("avatar.speech.segment"))
    {
        const FCodeBuddyAvatarCue Cue = ParseCue(Event);
        OnPerformanceCue.Broadcast(TurnId, Cue);
        OnSpeechText.Broadcast(
            TurnId,
            StringField(Event, TEXT("text")),
            Type == TEXT("avatar.speech.segment"));
    }
    else if (Type == TEXT("avatar.audio.started"))
    {
        BeginAudio(Event, TurnId);
    }
    else if (Type == TEXT("avatar.audio.chunk"))
    {
        AppendAudioChunk(Event);
    }
    else if (Type == TEXT("avatar.audio.ended"))
    {
        EndAudio(Event);
    }
    else if (Type == TEXT("avatar.speech.started"))
    {
        bSpeechStartReceived = true;
        SetPhase(ECodeBuddyAvatarPhase::Playing, TEXT("Speech started"));
        OnSpeechState.Broadcast(TurnId, true);
        PlayNextPreparedAudio(TurnId);
    }
    else if (Type == TEXT("avatar.speech.interrupted"))
    {
        ResetPlaybackState();
        SetPhase(ECodeBuddyAvatarPhase::Interrupted, TEXT("Speech interrupted"));
        OnSpeechState.Broadcast(TurnId, false);
    }
    else if (Type == TEXT("avatar.speech.failed"))
    {
        ResetPlaybackState();
        SetPhase(ECodeBuddyAvatarPhase::Error, TEXT("Speech failed"));
        OnSpeechState.Broadcast(TurnId, false);
    }
    else if (Type == TEXT("avatar.speech.completed"))
    {
        bTurnCompletionReceived = true;
        if (!ActiveAudioComponent && !HasPreparedAudioForTurn(TurnId))
        {
            FinalizeCompletedTurn(TurnId);
        }
    }
    else if (Type == TEXT("avatar.turn.silent"))
    {
        ResetPlaybackState();
        SetPhase(ECodeBuddyAvatarPhase::Ready, TEXT("Turn completed"));
        OnSpeechState.Broadcast(TurnId, false);
    }
}

void UCodeBuddyAvatarSubsystem::SendHello()
{
    const TSharedRef<FJsonObject> Capabilities = MakeShared<FJsonObject>();
    Capabilities->SetBoolField(TEXT("audioDrivenAnimation"), bAudioDrivenAnimationEnabled);
    Capabilities->SetBoolField(TEXT("wavStream"), true);
    Capabilities->SetBoolField(TEXT("affect"), true);
    Capabilities->SetBoolField(TEXT("gestures"), true);
    Capabilities->SetBoolField(TEXT("gaze"), true);
    Capabilities->SetBoolField(TEXT("interruptionAck"), true);

    const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
    Payload->SetStringField(TEXT("rendererId"), RendererId);
    Payload->SetStringField(TEXT("displayName"), DisplayName);
    Payload->SetNumberField(TEXT("protocolVersion"), ProtocolVersion);
    Payload->SetStringField(TEXT("runtime"), TEXT("unreal"));
    Payload->SetStringField(TEXT("runtimeVersion"), RuntimeVersion);
    Payload->SetStringField(TEXT("project"), ProjectPath);
    Payload->SetObjectField(TEXT("capabilities"), Capabilities);

    const TSharedRef<FJsonObject> Request = MakeShared<FJsonObject>();
    Request->SetStringField(TEXT("type"), TEXT("avatar.renderer.hello"));
    Request->SetObjectField(TEXT("payload"), Payload);
    SendJson(Request);
}

void UCodeBuddyAvatarSubsystem::SendSync()
{
    const TSharedRef<FJsonObject> Request = MakeShared<FJsonObject>();
    Request->SetStringField(TEXT("type"), TEXT("avatar.sync"));
    SendJson(Request);
}

void UCodeBuddyAvatarSubsystem::SendStatus()
{
    if (!bRegistered || !Socket.IsValid() || !Socket->IsConnected())
    {
        return;
    }

    int32 AudioBufferMs = 0;
    if (ActiveSoundWave && ActiveSampleRate > 0 && ActiveNumChannels > 0)
    {
        const int32 BytesPerSecond = ActiveSampleRate * ActiveNumChannels * 2;
        AudioBufferMs = BytesPerSecond > 0
            ? FMath::RoundToInt(
                1000.0 * ActiveSoundWave->GetAvailableAudioByteCount() / BytesPerSecond)
            : 0;
    }

    const TSharedRef<FJsonObject> Payload = MakeShared<FJsonObject>();
    Payload->SetStringField(TEXT("rendererId"), RendererId);
    Payload->SetStringField(TEXT("phase"), PhaseToWire(Phase));
    if (!ActiveTurnId.IsEmpty())
    {
        Payload->SetStringField(TEXT("activeTurnId"), ActiveTurnId);
    }
    Payload->SetNumberField(TEXT("lastSequence"), static_cast<double>(LastSequence));
    Payload->SetNumberField(TEXT("fps"), FMath::RoundToInt(SmoothedFps));
    Payload->SetNumberField(TEXT("audioBufferMs"), AudioBufferMs);
    Payload->SetNumberField(TEXT("mouthLatencyMs"), MouthLatencyMs);
    Payload->SetNumberField(TEXT("droppedAudioChunks"), DroppedAudioChunks);

    const TSharedRef<FJsonObject> Request = MakeShared<FJsonObject>();
    Request->SetStringField(TEXT("type"), TEXT("avatar.renderer.status"));
    Request->SetObjectField(TEXT("payload"), Payload);
    SendJson(Request);
    LastHeartbeatAt = FPlatformTime::Seconds();
}

void UCodeBuddyAvatarSubsystem::SendJson(const TSharedRef<FJsonObject>& Message)
{
    if (!Socket.IsValid() || !Socket->IsConnected())
    {
        return;
    }
    FString Serialized;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Serialized);
    if (FJsonSerializer::Serialize(Message, Writer))
    {
        Socket->Send(Serialized);
    }
}

void UCodeBuddyAvatarSubsystem::ScheduleReconnect()
{
    const double Exponent = FMath::Pow(2.0, FMath::Min(ReconnectAttempt, 10));
    const double Delay = FMath::Min(
        static_cast<double>(ReconnectMaxSeconds),
        static_cast<double>(ReconnectInitialSeconds) * Exponent);
    ++ReconnectAttempt;
    NextReconnectAt = FPlatformTime::Seconds() + Delay;
}

void UCodeBuddyAvatarSubsystem::FailAuthentication(const FString& Error)
{
    bAuthenticationBlocked = true;
    OnProtocolError.Broadcast(Error);
    SetPhase(ECodeBuddyAvatarPhase::Error, Error);
    if (Socket.IsValid())
    {
        Socket->Close(1008, TEXT("Avatar authentication failed"));
    }
}

void UCodeBuddyAvatarSubsystem::BeginAudio(
    const TSharedPtr<FJsonObject>& Event,
    const FString& TurnId)
{
    const FString StreamId = StringField(Event, TEXT("streamId"));
    const FString Format = StringField(Event, TEXT("format"));
    int64 AdvertisedMax = ProtocolMaxChunkBytes;
    IntegerField(Event, TEXT("maxChunkBytes"), AdvertisedMax);
    if (StreamId.IsEmpty() || Format != TEXT("wav_stream") ||
        AdvertisedMax < 1024 || AdvertisedMax > ProtocolMaxChunkBytes ||
        IncomingAudio.Contains(StreamId))
    {
        ++DroppedAudioChunks;
        OnProtocolError.Broadcast(TEXT("Invalid or duplicate avatar.audio.started event."));
        return;
    }

    FIncomingAudio Assembly;
    Assembly.TurnId = TurnId;
    Assembly.StreamId = StreamId;
    Assembly.MaxChunkBytes = static_cast<int32>(AdvertisedMax);
    IncomingAudio.Add(StreamId, MoveTemp(Assembly));
    if (!bSpeechStartReceived && !ActiveAudioComponent)
    {
        SetPhase(ECodeBuddyAvatarPhase::Buffering, TEXT("Receiving WAVE stream"));
    }
}

void UCodeBuddyAvatarSubsystem::AppendAudioChunk(const TSharedPtr<FJsonObject>& Event)
{
    FString StreamId = StringField(Event, TEXT("streamId"));
    if (StreamId.IsEmpty() && IncomingAudio.Num() == 1)
    {
        StreamId = IncomingAudio.CreateConstIterator().Key();
    }
    FIncomingAudio* Assembly = IncomingAudio.Find(StreamId);
    if (!Assembly)
    {
        ++DroppedAudioChunks;
        return;
    }

    int64 ChunkIndex = -1;
    if (!IntegerField(Event, TEXT("chunkIndex"), ChunkIndex))
    {
        DropAudioStream(StreamId, TEXT("Audio chunk has no integer chunkIndex."));
        return;
    }
    int64 ByteOffset = Assembly->NextByteOffset;
    if (Event->HasField(TEXT("byteOffset")) &&
        !IntegerField(Event, TEXT("byteOffset"), ByteOffset))
    {
        DropAudioStream(StreamId, TEXT("Audio chunk has an invalid byteOffset."));
        return;
    }
    const FString Encoded = StringField(Event, TEXT("data"));
    const int32 MaxEncodedChars = ((Assembly->MaxChunkBytes + 2) / 3) * 4 + 8;
    if (Encoded.IsEmpty() || Encoded.Len() > MaxEncodedChars)
    {
        DropAudioStream(StreamId, TEXT("Audio chunk base64 exceeds its bound."));
        return;
    }

    TArray<uint8> Decoded;
    if (!FBase64::Decode(Encoded, Decoded))
    {
        DropAudioStream(StreamId, TEXT("Audio chunk is not valid base64."));
        return;
    }
    int64 ByteLength = Decoded.Num();
    if (Event->HasField(TEXT("byteLength")) &&
        !IntegerField(Event, TEXT("byteLength"), ByteLength))
    {
        DropAudioStream(StreamId, TEXT("Audio chunk has an invalid byteLength."));
        return;
    }

    const bool bValid =
        ChunkIndex == Assembly->NextChunkIndex &&
        ByteOffset == Assembly->NextByteOffset &&
        ByteLength == Decoded.Num() &&
        Decoded.Num() <= Assembly->MaxChunkBytes &&
        Assembly->NextByteOffset <= MaxWavBytes - Decoded.Num();
    if (!bValid)
    {
        DropAudioStream(StreamId, TEXT("Audio chunk ordering, offset or size mismatch."));
        return;
    }

    Assembly->NextByteOffset += Decoded.Num();
    ++Assembly->NextChunkIndex;
    Assembly->Chunks.Add(MoveTemp(Decoded));
}

void UCodeBuddyAvatarSubsystem::EndAudio(const TSharedPtr<FJsonObject>& Event)
{
    const FString StreamId = StringField(Event, TEXT("streamId"));
    FIncomingAudio* Existing = IncomingAudio.Find(StreamId);
    if (!Existing)
    {
        ++DroppedAudioChunks;
        return;
    }
    FIncomingAudio Assembly = MoveTemp(*Existing);
    IncomingAudio.Remove(StreamId);

    const FString Outcome = StringField(Event, TEXT("outcome"));
    if (Outcome != TEXT("complete"))
    {
        return;
    }
    int64 TotalBytes = -1;
    int64 ChunkCount = -1;
    if (!IntegerField(Event, TEXT("totalBytes"), TotalBytes) ||
        !IntegerField(Event, TEXT("chunks"), ChunkCount) ||
        TotalBytes != Assembly.NextByteOffset ||
        ChunkCount != Assembly.NextChunkIndex ||
        TotalBytes < 0 || TotalBytes > MaxWavBytes)
    {
        ++DroppedAudioChunks;
        OnProtocolError.Broadcast(TEXT("avatar.audio.ended does not match received chunks."));
        return;
    }

    TArray<uint8> WavBytes;
    WavBytes.Reserve(static_cast<int32>(TotalBytes));
    for (const TArray<uint8>& Chunk : Assembly.Chunks)
    {
        WavBytes.Append(Chunk);
    }
    if (WavBytes.Num() != TotalBytes)
    {
        ++DroppedAudioChunks;
        return;
    }

    FCodeBuddyWavData Parsed;
    FString Error;
    if (!FCodeBuddyWavParser::ParsePcm16(WavBytes, Parsed, Error))
    {
        ++DroppedAudioChunks;
        OnProtocolError.Broadcast(Error);
        return;
    }

    FCodeBuddyPreparedWav BlueprintWav;
    BlueprintWav.TurnId = Assembly.TurnId;
    BlueprintWav.StreamId = Assembly.StreamId;
    BlueprintWav.SampleRate = Parsed.SampleRate;
    BlueprintWav.NumChannels = Parsed.NumChannels;
    BlueprintWav.DurationSeconds = Parsed.DurationSeconds;

    FPreparedAudio Prepared;
    Prepared.TurnId = Assembly.TurnId;
    Prepared.StreamId = Assembly.StreamId;
    Prepared.Wav = MoveTemp(Parsed);
    PreparedAudio.Add(MoveTemp(Prepared));
    OnWavPrepared.Broadcast(BlueprintWav);
    if (bSpeechStartReceived && !ActiveAudioComponent)
    {
        PlayNextPreparedAudio(Assembly.TurnId);
    }
}

void UCodeBuddyAvatarSubsystem::DropAudioStream(
    const FString& StreamId,
    const FString& Reason)
{
    IncomingAudio.Remove(StreamId);
    ++DroppedAudioChunks;
    OnProtocolError.Broadcast(Reason);
}

void UCodeBuddyAvatarSubsystem::PlayNextPreparedAudio(const FString& TurnId)
{
    if (ActiveAudioComponent)
    {
        return;
    }
    if (!bAutoPlayAudio)
    {
        PreparedAudio.RemoveAll(
            [&TurnId](const FPreparedAudio& Prepared)
            {
                return Prepared.TurnId == TurnId;
            });
        return;
    }
    int32 Match = INDEX_NONE;
    for (int32 Index = 0; Index < PreparedAudio.Num(); ++Index)
    {
        if (PreparedAudio[Index].TurnId == TurnId)
        {
            Match = Index;
            break;
        }
    }
    if (Match == INDEX_NONE)
    {
        return;
    }

    FPreparedAudio Prepared = MoveTemp(PreparedAudio[Match]);
    PreparedAudio.RemoveAt(Match);

    USoundWaveProcedural* SoundWave = NewObject<USoundWaveProcedural>(this);
    SoundWave->NumChannels = Prepared.Wav.NumChannels;
    SoundWave->SetSampleRate(static_cast<uint32>(Prepared.Wav.SampleRate), false);
    SoundWave->Duration = Prepared.Wav.DurationSeconds;
    SoundWave->SoundGroup = SOUNDGROUP_Voice;
    SoundWave->bLooping = false;
    SoundWave->QueueAudio(Prepared.Wav.PcmData.GetData(), Prepared.Wav.PcmData.Num());

    ActiveSoundWave = SoundWave;
    ActiveSampleRate = Prepared.Wav.SampleRate;
    ActiveNumChannels = Prepared.Wav.NumChannels;
    ActiveAudioComponent = UGameplayStatics::SpawnSound2D(
        this,
        SoundWave,
        1.0f,
        1.0f,
        0.0f,
        nullptr,
        false,
        true);
    if (ActiveAudioComponent)
    {
        ActiveAudioComponent->OnAudioFinished.AddDynamic(
            this,
            &UCodeBuddyAvatarSubsystem::HandleAudioFinished);
    }
    else
    {
        ActiveSoundWave = nullptr;
        ActiveSampleRate = 0;
        ActiveNumChannels = 0;
        SetPhase(ECodeBuddyAvatarPhase::Error, TEXT("Unable to create Unreal audio component"));
    }
}

bool UCodeBuddyAvatarSubsystem::HasPreparedAudioForTurn(const FString& TurnId) const
{
    return PreparedAudio.ContainsByPredicate(
        [&TurnId](const FPreparedAudio& Prepared)
        {
            return Prepared.TurnId == TurnId;
        });
}

void UCodeBuddyAvatarSubsystem::FinalizeCompletedTurn(const FString& TurnId)
{
    ResetPlaybackState();
    SetPhase(ECodeBuddyAvatarPhase::Ready, TEXT("Turn completed"));
    OnSpeechState.Broadcast(TurnId, false);
}

void UCodeBuddyAvatarSubsystem::StopActiveAudio()
{
    if (ActiveAudioComponent)
    {
        ActiveAudioComponent->OnAudioFinished.RemoveDynamic(
            this,
            &UCodeBuddyAvatarSubsystem::HandleAudioFinished);
        ActiveAudioComponent->Stop();
    }
    if (ActiveSoundWave)
    {
        ActiveSoundWave->ResetAudio();
    }
    ActiveAudioComponent = nullptr;
    ActiveSoundWave = nullptr;
    ActiveSampleRate = 0;
    ActiveNumChannels = 0;
}

void UCodeBuddyAvatarSubsystem::ResetPlaybackState()
{
    StopActiveAudio();
    IncomingAudio.Reset();
    PreparedAudio.Reset();
    ActiveTurnId.Reset();
    bSpeechStartReceived = false;
    bTurnCompletionReceived = false;
}

FCodeBuddyAvatarCue UCodeBuddyAvatarSubsystem::ParseCue(
    const TSharedPtr<FJsonObject>& Event) const
{
    FCodeBuddyAvatarCue Result;
    const TSharedPtr<FJsonObject> Cue = ObjectField(Event, TEXT("cue"));
    if (!Cue.IsValid())
    {
        return Result;
    }
    const FString Affect = StringField(Cue, TEXT("affect"));
    const FString Gesture = StringField(Cue, TEXT("gesture"));
    const FString Gaze = StringField(Cue, TEXT("gaze"));
    const FString Style = StringField(Cue, TEXT("speakingStyle"));
    Result.Affect = Affect.IsEmpty() ? Result.Affect : Affect;
    Result.Gesture = Gesture.IsEmpty() ? Result.Gesture : Gesture;
    Result.Gaze = Gaze.IsEmpty() ? Result.Gaze : Gaze;
    Result.SpeakingStyle = Style.IsEmpty() ? Result.SpeakingStyle : Style;
    double Intensity = 0.0;
    if (Cue->TryGetNumberField(TEXT("intensity"), Intensity) && FMath::IsFinite(Intensity))
    {
        Result.Intensity = FMath::Clamp(static_cast<float>(Intensity), 0.0f, 1.0f);
    }
    return Result;
}

void UCodeBuddyAvatarSubsystem::SetPhase(
    ECodeBuddyAvatarPhase NewPhase,
    const FString& Detail)
{
    if (Phase == NewPhase)
    {
        return;
    }
    Phase = NewPhase;
    OnPhaseChanged.Broadcast(Phase, Detail);
    if (bRegistered)
    {
        SendStatus();
    }
}

FString UCodeBuddyAvatarSubsystem::PhaseToWire(ECodeBuddyAvatarPhase Value)
{
    switch (Value)
    {
    case ECodeBuddyAvatarPhase::Ready:
        return TEXT("ready");
    case ECodeBuddyAvatarPhase::Buffering:
        return TEXT("buffering");
    case ECodeBuddyAvatarPhase::Playing:
        return TEXT("playing");
    case ECodeBuddyAvatarPhase::Interrupted:
        return TEXT("interrupted");
    case ECodeBuddyAvatarPhase::Unavailable:
        return TEXT("unavailable");
    case ECodeBuddyAvatarPhase::Error:
    default:
        return TEXT("error");
    }
}

bool UCodeBuddyAvatarSubsystem::IsTerminalEvent(const FString& Type)
{
    return Type == TEXT("avatar.speech.completed") ||
        Type == TEXT("avatar.speech.interrupted") ||
        Type == TEXT("avatar.speech.failed") ||
        Type == TEXT("avatar.turn.silent");
}

void UCodeBuddyAvatarSubsystem::HandleAudioFinished()
{
    if (ActiveAudioComponent)
    {
        ActiveAudioComponent->OnAudioFinished.RemoveDynamic(
            this,
            &UCodeBuddyAvatarSubsystem::HandleAudioFinished);
    }
    ActiveAudioComponent = nullptr;
    ActiveSoundWave = nullptr;
    ActiveSampleRate = 0;
    ActiveNumChannels = 0;
    if (bSpeechStartReceived && !ActiveTurnId.IsEmpty())
    {
        PlayNextPreparedAudio(ActiveTurnId);
    }
    if (bTurnCompletionReceived && !ActiveAudioComponent &&
        !ActiveTurnId.IsEmpty() && !HasPreparedAudioForTurn(ActiveTurnId))
    {
        const FString CompletedTurnId = ActiveTurnId;
        FinalizeCompletedTurn(CompletedTurnId);
    }
    if (bRegistered)
    {
        SendStatus();
    }
}
