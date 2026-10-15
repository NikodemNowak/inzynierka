Pod::Spec.new do |s|
  s.name = 'NotatkiCapture'
  s.version = '1.0.0'
  s.summary = 'Local durable audio capture for Notatki'
  s.description = 'Native audio capture, recovery and local speech windows.'
  s.license = { :type => 'MIT' }
  s.author = 'Nikodem Nowak'
  s.homepage = 'https://github.com/NikodemNowak/inzynierka'
  s.platform = :ios, '17.0'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/NikodemNowak/inzynierka.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Speech'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
