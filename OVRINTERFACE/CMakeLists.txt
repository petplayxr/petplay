#region init

cmake_minimum_required(VERSION 3.10)
message("${CMAKE_CURRENT_SOURCE_DIR}")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_SIZEOF_VOID_P 8)

#region BUILD MAIN PROGRAM

project(petplay)
add_executable(petplay Ispawnoverlay.cpp
overlay.cpp overlay.h
websocketserver.h
)

#openvr
target_include_directories(petplay PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/include)
find_library(OPENVR_LIBRARIES NAMES openvr_api PATHS ${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/lib)
find_library(OPENVR_LIBRARIES_DEBUG NAMES openvr_api PATHS ${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/debug/lib)
#zmq
find_package(cppzmq CONFIG REQUIRED)
#json
find_package(nlohmann_json CONFIG REQUIRED)

target_link_libraries(petplay PRIVATE
nlohmann_json::nlohmann_json
cppzmq cppzmq-static
${OPENVR_LIBRARIES}
)
target_link_libraries(petplay PRIVATE "$<$<CONFIG:DEBUG>:${OPENVR_LIBRARIES_DEBUG}>")

#region OVRINPUT

add_executable(ovrinput Iinputinterface.cpp
overlay.cpp overlay.h
websocketserver.h
)

#openvr
target_include_directories(ovrinput PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/include)
find_library(OPENVR_LIBRARIES NAMES openvr_api PATHS ${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/lib)
find_library(OPENVR_LIBRARIES_DEBUG NAMES openvr_api PATHS ${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows/debug/lib)
#zmq
find_package(cppzmq CONFIG REQUIRED)
#json
find_package(nlohmann_json CONFIG REQUIRED)

target_link_libraries(ovrinput PRIVATE
nlohmann_json::nlohmann_json
cppzmq cppzmq-static
${OPENVR_LIBRARIES}
)
target_link_libraries(ovrinput PRIVATE "$<$<CONFIG:DEBUG>:${OPENVR_LIBRARIES_DEBUG}>")