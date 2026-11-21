import 'package:flutter/material.dart';

/// A finite entrance animation while the saved session and appearance load.
class StartupScreen extends StatelessWidget {
  const StartupScreen({super.key, required this.onFinished});
  final VoidCallback onFinished;

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Semantics(
              label: 'waweigg',
              child: ExcludeSemantics(
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1),
                  duration: reducedMotion
                      ? Duration.zero
                      : const Duration(milliseconds: 1100),
                  curve: Curves.easeOutCubic,
                  onEnd: onFinished,
                  builder: (context, progress, child) => Opacity(
                    opacity: .25 + .75 * progress,
                    child: Transform.translate(
                      offset: Offset(
                        0,
                        reducedMotion ? 0 : 12 * (1 - progress),
                      ),
                      child: Transform.scale(
                        scale: reducedMotion ? 1 : .94 + .06 * progress,
                        child: child,
                      ),
                    ),
                  ),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      'waweigg',
                      style: Theme.of(context).textTheme.headlineLarge
                          ?.copyWith(
                            fontSize: 48,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -1.8,
                          ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
