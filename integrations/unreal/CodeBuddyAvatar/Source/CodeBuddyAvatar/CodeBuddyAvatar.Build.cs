using UnrealBuildTool;

public class CodeBuddyAvatar : ModuleRules
{
    public CodeBuddyAvatar(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "AudioMixer",
            "Json",
            "JsonUtilities",
            "WebSockets"
        });
    }
}
