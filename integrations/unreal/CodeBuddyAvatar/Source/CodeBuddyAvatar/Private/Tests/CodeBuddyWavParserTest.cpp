#if WITH_DEV_AUTOMATION_TESTS

#include "CodeBuddyWavParser.h"
#include "Misc/AutomationTest.h"

namespace
{
void WriteLe16(TArray<uint8>& Bytes, int32 Offset, uint16 Value)
{
    Bytes[Offset] = static_cast<uint8>(Value & 0xff);
    Bytes[Offset + 1] = static_cast<uint8>((Value >> 8) & 0xff);
}

void WriteLe32(TArray<uint8>& Bytes, int32 Offset, uint32 Value)
{
    Bytes[Offset] = static_cast<uint8>(Value & 0xff);
    Bytes[Offset + 1] = static_cast<uint8>((Value >> 8) & 0xff);
    Bytes[Offset + 2] = static_cast<uint8>((Value >> 16) & 0xff);
    Bytes[Offset + 3] = static_cast<uint8>((Value >> 24) & 0xff);
}

TArray<uint8> BuildMonoPcmWav()
{
    TArray<uint8> Bytes;
    Bytes.SetNumZeroed(48);
    FMemory::Memcpy(Bytes.GetData(), "RIFF", 4);
    WriteLe32(Bytes, 4, 40);
    FMemory::Memcpy(Bytes.GetData() + 8, "WAVE", 4);
    FMemory::Memcpy(Bytes.GetData() + 12, "fmt ", 4);
    WriteLe32(Bytes, 16, 16);
    WriteLe16(Bytes, 20, 1);
    WriteLe16(Bytes, 22, 1);
    WriteLe32(Bytes, 24, 16000);
    WriteLe32(Bytes, 28, 32000);
    WriteLe16(Bytes, 32, 2);
    WriteLe16(Bytes, 34, 16);
    FMemory::Memcpy(Bytes.GetData() + 36, "data", 4);
    WriteLe32(Bytes, 40, 4);
    WriteLe16(Bytes, 44, 1000);
    WriteLe16(Bytes, 46, static_cast<uint16>(static_cast<int16>(-1000)));
    return Bytes;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCodeBuddyWavParserValidTest,
    "CodeBuddy.Avatar.Wav.ValidPcm16",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCodeBuddyWavParserValidTest::RunTest(const FString& Parameters)
{
    (void)Parameters;
    FCodeBuddyWavData Wav;
    FString Error;
    const bool bParsed = FCodeBuddyWavParser::ParsePcm16(BuildMonoPcmWav(), Wav, Error);
    TestTrue(TEXT("valid PCM WAVE parses"), bParsed);
    TestEqual(TEXT("sample rate"), Wav.SampleRate, 16000);
    TestEqual(TEXT("channels"), Wav.NumChannels, 1);
    TestEqual(TEXT("bits"), Wav.BitsPerSample, 16);
    TestEqual(TEXT("PCM bytes"), Wav.PcmData.Num(), 4);
    TestTrue(TEXT("duration is positive"), Wav.DurationSeconds > 0.0f);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCodeBuddyWavParserTruncatedTest,
    "CodeBuddy.Avatar.Wav.RejectsTruncatedRiff",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCodeBuddyWavParserTruncatedTest::RunTest(const FString& Parameters)
{
    (void)Parameters;
    TArray<uint8> Bytes = BuildMonoPcmWav();
    Bytes.SetNum(20);
    FCodeBuddyWavData Wav;
    FString Error;
    TestFalse(TEXT("truncated WAVE is rejected"), FCodeBuddyWavParser::ParsePcm16(Bytes, Wav, Error));
    TestFalse(TEXT("error is actionable"), Error.IsEmpty());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(
    FCodeBuddyWavParserMissingPaddingTest,
    "CodeBuddy.Avatar.Wav.RejectsMissingChunkPadding",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FCodeBuddyWavParserMissingPaddingTest::RunTest(const FString& Parameters)
{
    (void)Parameters;
    TArray<uint8> Bytes = BuildMonoPcmWav();
    const int32 JunkOffset = Bytes.AddUninitialized(9);
    FMemory::Memcpy(Bytes.GetData() + JunkOffset, "JUNK", 4);
    WriteLe32(Bytes, JunkOffset + 4, 1);
    Bytes[JunkOffset + 8] = 42;
    WriteLe32(Bytes, 4, static_cast<uint32>(Bytes.Num() - 8));

    FCodeBuddyWavData Wav;
    FString Error;
    TestFalse(
        TEXT("an odd chunk without its padding byte is rejected"),
        FCodeBuddyWavParser::ParsePcm16(Bytes, Wav, Error));
    TestTrue(TEXT("padding failure is identified"), Error.Contains(TEXT("unpadded")));
    return true;
}

#endif
