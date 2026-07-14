#pragma once

#include "CoreMinimal.h"
#include "CodeBuddyAvatarTypes.generated.h"

UENUM(BlueprintType)
enum class ECodeBuddyAvatarPhase : uint8
{
    Ready,
    Buffering,
    Playing,
    Interrupted,
    Unavailable,
    Error
};

USTRUCT(BlueprintType)
struct CODEBUDDYAVATAR_API FCodeBuddyAvatarCue
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString Affect = TEXT("neutral");

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    float Intensity = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString Gesture = TEXT("none");

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString Gaze = TEXT("user");

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString SpeakingStyle = TEXT("conversational");
};

USTRUCT(BlueprintType)
struct CODEBUDDYAVATAR_API FCodeBuddyPreparedWav
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString TurnId;

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    FString StreamId;

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    int32 SampleRate = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    int32 NumChannels = 0;

    UPROPERTY(BlueprintReadOnly, Category = "Code Buddy|Avatar")
    float DurationSeconds = 0.0f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FCodeBuddyAvatarConnectionEvent,
    bool,
    bConnected,
    const FString&,
    Detail);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FCodeBuddyAvatarPhaseEvent,
    ECodeBuddyAvatarPhase,
    Phase,
    const FString&,
    Detail);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FCodeBuddyAvatarCueEvent,
    const FString&,
    TurnId,
    const FCodeBuddyAvatarCue&,
    Cue);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(
    FCodeBuddyAvatarTextEvent,
    const FString&,
    TurnId,
    const FString&,
    Text,
    bool,
    bSegment);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FCodeBuddyAvatarWavEvent,
    const FCodeBuddyPreparedWav&,
    Wav);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FCodeBuddyAvatarSpeechEvent,
    const FString&,
    TurnId,
    bool,
    bStarted);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FCodeBuddyAvatarErrorEvent,
    const FString&,
    Error);
